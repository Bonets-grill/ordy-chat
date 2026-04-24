import { and, eq, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import {
  auditLog,
  orders,
  posPayments,
  resellerCommissions,
  resellerPayouts,
  resellers,
  stripeEvents,
  tableSessions,
  tenants,
} from "@/lib/db/schema";
import { markOrderPaidByPaymentIntent, markOrderPaidBySession } from "@/lib/orders";
import { generateAndSendReceipt } from "@/lib/receipts";
import { stripeClient, stripeWebhookSecret } from "@/lib/stripe";

export const runtime = "nodejs";

function mapStatus(s: Stripe.Subscription.Status): string {
  if (s === "trialing") return "trialing";
  if (s === "active") return "active";
  if (s === "past_due") return "past_due";
  if (s === "unpaid") return "unpaid";
  if (s === "canceled" || s === "incomplete_expired") return "canceled";
  return "past_due";
}

export async function POST(req: Request) {
  const body = await req.text();
  const signature = req.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "no signature" }, { status: 400 });

  const stripe = await stripeClient();
  const secret = await stripeWebhookSecret();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, secret);
  } catch (e) {
    return NextResponse.json({ error: `invalid signature: ${(e as Error).message}` }, { status: 400 });
  }

  // Idempotencia: INSERT ... ON CONFLICT DO NOTHING. Si el evento ya existe,
  // devolvemos 200 sin reprocesar — Stripe dejará de reintentar.
  try {
    const inserted = await db
      .insert(stripeEvents)
      .values({ eventId: event.id, eventType: event.type })
      .onConflictDoNothing()
      .returning({ eventId: stripeEvents.eventId });
    if (inserted.length === 0) {
      return NextResponse.json({ received: true, duplicate: true });
    }
  } catch (e) {
    console.error(`[stripe] dedupe insert failed: ${(e as Error).message}`);
    // Seguimos procesando — mejor procesar dos veces que romper la cadena.
  }

  // `sql` import usado si algún día queremos UPSERT más complejo.
  void sql;

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const sess = event.data.object as Stripe.Checkout.Session;
        const tenantId = sess.metadata?.tenant_id;
        const orderId = sess.metadata?.order_id;

        // Flow A: suscripción del tenant (€49.90/mes).
        if (tenantId && sess.subscription) {
          const subId = typeof sess.subscription === "string" ? sess.subscription : sess.subscription.id;
          const sub = await stripe.subscriptions.retrieve(subId);
          await db
            .update(tenants)
            .set({
              stripeSubscriptionId: subId,
              subscriptionStatus: mapStatus(sub.status),
              updatedAt: new Date(),
            })
            .where(eq(tenants.id, tenantId));
        }

        // Flow B: pedido del comensal (mesero digital).
        if (orderId && sess.mode === "payment") {
          const pi = typeof sess.payment_intent === "string" ? sess.payment_intent : sess.payment_intent?.id;
          const updated = await markOrderPaidBySession(sess.id, pi);
          if (updated) {
            const customerEmail = sess.customer_details?.email ?? sess.customer_email ?? null;
            try {
              await generateAndSendReceipt(updated.id, customerEmail);
            } catch (err) {
              console.error("[receipt] generate failed:", err);
              // Nunca bloqueamos el webhook: Stripe no debe reintentarlo por un
              // fallo en la capa de recibos. El receipt queda en DB con status
              // 'error' para remediation manual desde el dashboard del tenant.
            }
          }
        }

        // Flow C (Fase 4): sesión de mesa completa pagada por el cliente
        // desde su móvil. Transiciona la sesión a 'paid' y marca todos los
        // orders linkeados como paid también. Webhooks idempotentes: si
        // la sesión ya está paid, los UPDATE con WHERE status=... no tocan.
        const tableSessionId = sess.metadata?.table_session_id;
        if (tableSessionId && sess.mode === "payment") {
          const now = new Date();
          await db
            .update(tableSessions)
            .set({
              status: "paid",
              paymentMethod: "stripe",
              paidAt: now,
              updatedAt: now,
            })
            .where(
              and(
                eq(tableSessions.id, tableSessionId),
                // Idempotencia: si otro webhook ya lo marcó, no retrocedemos.
                sql`${tableSessions.status} IN ('billing', 'active', 'pending')`,
              ),
            );
          // Marcar todos los pedidos de la sesión como paid.
          await db
            .update(orders)
            .set({ status: "paid", paidAt: now, updatedAt: now })
            .where(
              and(
                eq(orders.sessionId, tableSessionId),
                sql`${orders.status} <> 'paid'`,
              ),
            );
        }
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.created":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const tenantId = (sub.metadata?.tenant_id as string) ?? null;
        if (tenantId) {
          await db
            .update(tenants)
            .set({
              subscriptionStatus: mapStatus(sub.status),
              stripeSubscriptionId: sub.id,
              updatedAt: new Date(),
            })
            .where(eq(tenants.id, tenantId));
        }
        break;
      }
      // ── Reseller program (F4) ──────────────────────────────
      case "invoice.paid": {
        await handleInvoicePaid(event.data.object as Stripe.Invoice);
        break;
      }
      case "charge.refunded": {
        await handleChargeRefunded(event.data.object as Stripe.Charge);
        break;
      }
      case "payout.paid": {
        await handlePayoutPaid(event.data.object as Stripe.Payout);
        break;
      }
      case "payout.failed": {
        await handlePayoutFailed(event.data.object as Stripe.Payout);
        break;
      }
      case "account.updated": {
        await handleAccountUpdated(event.data.object as Stripe.Account);
        break;
      }
      // ── Stripe Terminal (mig 045): cobro en TPV físico ─────
      case "payment_intent.succeeded": {
        await handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent);
        break;
      }
      case "payment_intent.payment_failed":
      case "payment_intent.canceled": {
        await handlePaymentIntentFailed(
          event.data.object as Stripe.PaymentIntent,
          event.type === "payment_intent.canceled" ? "canceled" : "failed",
        );
        break;
      }
      case "account.application.deauthorized": {
        // data.object = Stripe.Application (solo id). El connected account id
        // viene en event.account (poblado cuando el evento es de una connected
        // account).
        if (event.account) {
          await handleAccountDeauthorized(event.account);
        }
        break;
      }
      default:
        break;
    }

    await db.insert(auditLog).values({ action: `stripe.${event.type}`, entity: "stripe_event", entityId: event.id });
    return NextResponse.json({ received: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// ─── F4 helpers: reseller commission + payout webhook handlers ────────

async function handleInvoicePaid(inv: Stripe.Invoice) {
  // Solo invoices de suscripción (no pagos one-off del mesero).
  const subId = typeof inv.subscription === "string" ? inv.subscription : inv.subscription?.id;
  if (!subId) return;

  // Resolver tenant por subscription
  const [t] = await db
    .select({ id: tenants.id, resellerId: tenants.resellerId })
    .from(tenants)
    .where(eq(tenants.stripeSubscriptionId, subId))
    .limit(1);
  if (!t?.resellerId) return; // sin reseller atribuido → no commission

  // Resolver reseller activo
  const [r] = await db
    .select({ id: resellers.id, commissionRate: resellers.commissionRate, status: resellers.status })
    .from(resellers)
    .where(eq(resellers.id, t.resellerId))
    .limit(1);
  if (!r || r.status !== "active") return;

  // Base = subtotal_excluding_tax ?? subtotal ?? amount_paid.
  // Priorizamos subtotal_excluding_tax (Stripe API 2024-06+), fallback a subtotal
  // (incluye discounts pero no tax), último recurso amount_paid (incluye tax).
  type ExtendedInvoice = Stripe.Invoice & { subtotal_excluding_tax?: number | null };
  const invExt = inv as ExtendedInvoice;
  const gross = inv.amount_paid ?? 0;
  const base = invExt.subtotal_excluding_tax ?? inv.subtotal ?? gross;
  if (base <= 0) return; // promo 100% / credit note — skip

  const rate = Number(r.commissionRate);
  const commission = Math.floor(base * rate);

  const paidAt = inv.status_transitions?.paid_at ?? inv.created;
  const paidDate = new Date(paidAt * 1000);
  const periodMonth = new Date(
    Date.UTC(paidDate.getUTCFullYear(), paidDate.getUTCMonth(), 1),
  );

  const chargeId = typeof inv.charge === "string" ? inv.charge : inv.charge?.id ?? null;
  const customerId = typeof inv.customer === "string" ? inv.customer : inv.customer?.id ?? "";

  await db
    .insert(resellerCommissions)
    .values({
      resellerId: r.id,
      tenantId: t.id,
      stripeInvoiceId: inv.id,
      stripeChargeId: chargeId,
      stripeCustomerId: customerId,
      currency: (inv.currency ?? "eur").toUpperCase(),
      grossAmountCents: gross,
      baseAmountCents: base,
      commissionRateSnapshot: r.commissionRate,
      commissionAmountCents: commission,
      periodMonth,
      invoicePaidAt: paidDate,
      status: "pending",
    })
    .onConflictDoNothing({ target: resellerCommissions.stripeInvoiceId });
}

async function handleChargeRefunded(ch: Stripe.Charge) {
  // Flags todas las commissions asociadas al charge como reversed.
  // Si alguna ya estaba 'paid' (payout ya ejecutado), incrementa
  // commission_debt_cents del reseller para descontar del siguiente batch.
  const [affected] = await db
    .select({
      id: resellerCommissions.id,
      resellerId: resellerCommissions.resellerId,
      status: resellerCommissions.status,
      amount: resellerCommissions.commissionAmountCents,
    })
    .from(resellerCommissions)
    .where(eq(resellerCommissions.stripeChargeId, ch.id))
    .limit(1);
  if (!affected) return;

  const wasAlreadyPaid = affected.status === "paid";
  await db
    .update(resellerCommissions)
    .set({ status: "reversed", refundedAt: new Date() })
    .where(eq(resellerCommissions.stripeChargeId, ch.id));

  if (wasAlreadyPaid) {
    // Clawback sintético: suma a la deuda, se resta del próximo payout.
    await db
      .update(resellers)
      .set({
        commissionDebtCents: sql`${resellers.commissionDebtCents} + ${affected.amount}`,
      })
      .where(eq(resellers.id, affected.resellerId));

    await db.insert(auditLog).values({
      action: "reseller.commission.debt_incremented",
      entity: "reseller",
      entityId: affected.resellerId,
      metadata: {
        commission_id: affected.id,
        amount_cents: affected.amount,
        reason: "charge_refunded_after_payout",
      },
    });
  }
}

async function handlePayoutPaid(po: Stripe.Payout) {
  await db
    .update(resellerPayouts)
    .set({
      status: "paid",
      paidAt: new Date(po.arrival_date * 1000),
      payoutTotalCents: po.amount,
    })
    .where(eq(resellerPayouts.stripePayoutId, po.id));
}

async function handlePayoutFailed(po: Stripe.Payout) {
  await db
    .update(resellerPayouts)
    .set({
      status: "failed",
      failureCode: po.failure_code ?? null,
      failureMessage: po.failure_message ?? null,
    })
    .where(eq(resellerPayouts.stripePayoutId, po.id));
}

async function handleAccountUpdated(acct: Stripe.Account) {
  const payoutsEnabled = Boolean(acct.payouts_enabled);
  const chargesEnabled = Boolean(acct.charges_enabled);
  const disabled = acct.requirements?.disabled_reason ?? null;
  const status =
    payoutsEnabled && chargesEnabled
      ? "active"
      : disabled
        ? "restricted"
        : "pending";

  await db
    .update(resellers)
    .set({
      stripeConnectStatus: status,
      stripeConnectPayoutsEnabled: payoutsEnabled,
      stripeConnectChargesEnabled: chargesEnabled,
    })
    .where(eq(resellers.stripeConnectAccountId, acct.id));
}

async function handleAccountDeauthorized(accountId: string) {
  // El reseller desconectó la cuenta Stripe. Auto-pause + limpia flags.
  await db
    .update(resellers)
    .set({
      stripeConnectStatus: "deauthorized",
      stripeConnectPayoutsEnabled: false,
      stripeConnectChargesEnabled: false,
      status: "paused",
    })
    .where(eq(resellers.stripeConnectAccountId, accountId));

  await db.insert(auditLog).values({
    action: "reseller.stripe_connect.deauthorized",
    entity: "reseller",
    metadata: { stripe_account_id: accountId },
  });
}

// ─── Mig 045: Stripe Terminal payment_intent handlers ─────────────────

async function handlePaymentIntentSucceeded(pi: Stripe.PaymentIntent) {
  // Solo procesamos PaymentIntents creados desde el flujo Ordy Terminal.
  // Stripe nos manda TODOS los payment_intent eventos del webhook global —
  // los de subscripciones (€49.90/mes) tienen otro source y NO tocan orders.
  if (pi.metadata?.source !== "ordy_terminal") return;

  const tenantId = pi.metadata?.tenant_id;
  const orderId = pi.metadata?.order_id;
  if (!tenantId || !orderId) {
    console.warn(`[terminal] PI ${pi.id} sin tenant_id/order_id en metadata`);
    return;
  }

  // Idempotente: UPDATE pos_payments status='succeeded' donde PI matches.
  await db
    .update(posPayments)
    .set({ status: "succeeded", updatedAt: new Date() })
    .where(eq(posPayments.paymentIntentId, pi.id));

  // Marcar orden pagada (paymentMethod='card', stripePaymentIntentId).
  const updated = await markOrderPaidByPaymentIntent(pi.id, tenantId, orderId);

  if (updated) {
    await db.insert(auditLog).values({
      action: "terminal.payment.succeeded",
      entity: "order",
      entityId: updated.id,
      metadata: {
        payment_intent_id: pi.id,
        amount_cents: pi.amount,
        tenant_id: tenantId,
      },
    });
    // Receipt opcional. Stripe Terminal no captura email del comensal —
    // si la orden tiene customerName/phone podríamos vincularlo, pero el
    // recibo email queda como mejora futura. NO bloqueamos webhook.
    try {
      await generateAndSendReceipt(updated.id, null);
    } catch (err) {
      console.error("[terminal][receipt] generate failed:", err);
    }
  }
}

async function handlePaymentIntentFailed(
  pi: Stripe.PaymentIntent,
  reason: "failed" | "canceled",
) {
  if (pi.metadata?.source !== "ordy_terminal") return;

  await db
    .update(posPayments)
    .set({ status: reason, updatedAt: new Date() })
    .where(eq(posPayments.paymentIntentId, pi.id));

  await db.insert(auditLog).values({
    action: `terminal.payment.${reason}`,
    entity: "payment_intent",
    entityId: pi.id,
    metadata: {
      tenant_id: pi.metadata?.tenant_id ?? null,
      order_id: pi.metadata?.order_id ?? null,
      last_payment_error: pi.last_payment_error?.message ?? null,
    },
  });
}

// Silencia warning de "isNull/and imports used" si Drizzle infiere distinto.
void isNull;
void and;
