// web/lib/orders.ts — Lógica de negocio de pedidos del mesero digital.
//
// Un pedido se crea desde el runtime (bot WhatsApp detectó intent "pedir") o
// desde un endpoint interno (panel/POS en el futuro). Al crearse se calculan
// subtotales, IVA y total en céntimos. Al generar el cobro, web crea un Stripe
// Checkout Session dedicated a esa orden y devuelve la URL al bot para que la
// reenvíe al comensal.

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentConfigs, orderItems, orders, tenants } from "@/lib/db/schema";
import { stripeClient } from "@/lib/stripe";

export type OrderItemInput = {
  name: string;
  quantity: number;
  /** Precio unitario SIN IVA, en céntimos. */
  unitPriceCents: number;
  /** Tipo de IVA. Si se omite, usa el default del tenant. */
  vatRate?: number;
  notes?: string;
};

export type CreateOrderInput = {
  tenantId: string;
  customerPhone?: string;
  customerName?: string;
  tableNumber?: string;
  items: OrderItemInput[];
  notes?: string;
};

export type OrderTotals = {
  subtotalCents: number;
  vatCents: number;
  totalCents: number;
};

/**
 * Calcula subtotal, IVA y total a partir de las líneas. Todos los cents.
 * IVA por línea, pero se reporta como total agregado.
 */
export function computeTotals(items: OrderItemInput[], defaultVatRate: number): OrderTotals {
  let subtotal = 0;
  let vat = 0;
  for (const item of items) {
    const lineTotal = item.quantity * item.unitPriceCents;
    const rate = (item.vatRate ?? defaultVatRate) / 100;
    const lineVat = Math.round(lineTotal * rate);
    subtotal += lineTotal;
    vat += lineVat;
  }
  return { subtotalCents: subtotal, vatCents: vat, totalCents: subtotal + vat };
}

/** Crea un pedido en estado `pending` con sus líneas. Transaccional. */
export async function createOrder(input: CreateOrderInput) {
  const [tenant] = await db
    .select({ defaultVatRate: tenants.defaultVatRate, currency: tenants.billingCountry })
    .from(tenants)
    .where(eq(tenants.id, input.tenantId))
    .limit(1);
  if (!tenant) throw new Error("tenant_not_found");

  const defaultVat = parseFloat(tenant.defaultVatRate ?? "10.00");
  const totals = computeTotals(input.items, defaultVat);

  const [order] = await db
    .insert(orders)
    .values({
      tenantId: input.tenantId,
      customerPhone: input.customerPhone,
      customerName: input.customerName,
      tableNumber: input.tableNumber,
      notes: input.notes,
      subtotalCents: totals.subtotalCents,
      vatCents: totals.vatCents,
      totalCents: totals.totalCents,
      currency: "EUR",
    })
    .returning();

  if (input.items.length > 0) {
    await db.insert(orderItems).values(
      input.items.map((it) => {
        const lineTotal = it.quantity * it.unitPriceCents;
        return {
          orderId: order.id,
          tenantId: input.tenantId,
          name: it.name,
          quantity: it.quantity,
          unitPriceCents: it.unitPriceCents,
          vatRate: String((it.vatRate ?? defaultVat).toFixed(2)),
          lineTotalCents: lineTotal,
          notes: it.notes,
        };
      }),
    );
  }

  return order;
}

export type PaymentLinkResult =
  | { kind: "online"; url: string; sessionId: string }
  | { kind: "offline"; reason: "not_accepted" | "stripe_not_configured" | "stripe_error"; paymentMethods: string[]; paymentNotes: string | null };

/**
 * Genera un Stripe Checkout Session para cobrar una orden. Si el tenant NO
 * acepta pagos online (accept_online_payment=false) o Stripe no está configurado,
 * devuelve kind:"offline" con los métodos de pago aceptados — el bot dirá al
 * cliente que pague al recoger / en efectivo / etc.
 */
export async function createPaymentLink(orderId: string, baseUrl: string): Promise<PaymentLinkResult> {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) throw new Error("order_not_found");
  if (order.status === "paid") throw new Error("order_already_paid");

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, order.tenantId)).limit(1);
  if (!tenant) throw new Error("tenant_not_found");

  const [cfg] = await db
    .select({
      paymentMethods: agentConfigs.paymentMethods,
      acceptOnlinePayment: agentConfigs.acceptOnlinePayment,
      paymentNotes: agentConfigs.paymentNotes,
    })
    .from(agentConfigs)
    .where(eq(agentConfigs.tenantId, order.tenantId))
    .limit(1);
  const paymentMethods = cfg?.paymentMethods ?? ["on_pickup", "cash"];
  const paymentNotes = cfg?.paymentNotes ?? null;

  // Gate 1: el tenant no acepta online → offline directo.
  if (!cfg?.acceptOnlinePayment) {
    await db
      .update(orders)
      .set({ status: "pending", updatedAt: new Date() })
      .where(eq(orders.id, order.id));
    return { kind: "offline", reason: "not_accepted", paymentMethods, paymentNotes };
  }

  const lines = await db
    .select()
    .from(orderItems)
    .where(and(eq(orderItems.orderId, order.id), eq(orderItems.tenantId, order.tenantId)));

  // Gate 2: Stripe puede no estar configurado en esta instancia (dev, sin keys aún).
  let stripe;
  try {
    stripe = await stripeClient();
  } catch {
    await db
      .update(orders)
      .set({ status: "pending", updatedAt: new Date() })
      .where(eq(orders.id, order.id));
    return { kind: "offline", reason: "stripe_not_configured", paymentMethods, paymentNotes };
  }

  let session: Awaited<ReturnType<typeof stripe.checkout.sessions.create>>;
  try {
    session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: lines.map((ln) => {
      const unitWithVat = Math.round(ln.unitPriceCents * (1 + parseFloat(ln.vatRate) / 100));
      return {
        price_data: {
          currency: order.currency.toLowerCase(),
          product_data: {
            name: ln.name,
            ...(ln.notes ? { description: ln.notes } : {}),
          },
          unit_amount: unitWithVat,
        },
        quantity: ln.quantity,
      };
    }),
    success_url: `${baseUrl}/pay/thanks?order=${order.id}`,
    cancel_url: `${baseUrl}/pay/canceled?order=${order.id}`,
    metadata: {
      tenant_id: order.tenantId,
      order_id: order.id,
      table_number: order.tableNumber ?? "",
    },
    // El email del comensal (si tenemos phone en metadata, Stripe solo pide email al pagar)
    payment_intent_data: {
      metadata: {
        tenant_id: order.tenantId,
        order_id: order.id,
      },
      ...(tenant.legalName ? { statement_descriptor_suffix: tenant.legalName.slice(0, 22) } : {}),
    },
  });
  } catch (err) {
    console.error("[stripe] checkout.sessions.create failed:", err);
    await db
      .update(orders)
      .set({ status: "pending", updatedAt: new Date() })
      .where(eq(orders.id, order.id));
    return { kind: "offline", reason: "stripe_error", paymentMethods, paymentNotes };
  }

  await db
    .update(orders)
    .set({
      status: "awaiting_payment",
      stripeCheckoutSessionId: session.id,
      stripePaymentLinkUrl: session.url ?? null,
      updatedAt: new Date(),
    })
    .where(eq(orders.id, order.id));

  return { kind: "online", url: session.url ?? "", sessionId: session.id };
}

/**
 * Marca la orden como pagada desde el webhook de Stripe.
 * Idempotente por stripeCheckoutSessionId.
 */
export async function markOrderPaidBySession(sessionId: string, paymentIntentId?: string) {
  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.stripeCheckoutSessionId, sessionId))
    .limit(1);
  if (!order) return null;
  if (order.status === "paid") return order; // ya procesado

  const [updated] = await db
    .update(orders)
    .set({
      status: "paid",
      paidAt: new Date(),
      stripePaymentIntentId: paymentIntentId ?? order.stripePaymentIntentId,
      updatedAt: new Date(),
    })
    .where(eq(orders.id, order.id))
    .returning();
  return updated;
}
