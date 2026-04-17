import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { auditLog, tenants } from "@/lib/db/schema";
import { markOrderPaidBySession } from "@/lib/orders";
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

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const sess = event.data.object as Stripe.Checkout.Session;
        const tenantId = sess.metadata?.tenant_id;
        const orderId = sess.metadata?.order_id;

        // Flow A: suscripción del tenant (€19.90/mes).
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
      default:
        break;
    }

    await db.insert(auditLog).values({ action: `stripe.${event.type}`, entity: "stripe_event", entityId: event.id });
    return NextResponse.json({ received: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
