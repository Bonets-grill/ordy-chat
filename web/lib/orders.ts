// web/lib/orders.ts — Lógica de negocio de pedidos del mesero digital.
//
// Un pedido se crea desde el runtime (bot WhatsApp detectó intent "pedir") o
// desde un endpoint interno (panel/POS en el futuro). Al crearse se calculan
// subtotales, IVA y total en céntimos. Al generar el cobro, web crea un Stripe
// Checkout Session dedicated a esa orden y devuelve la URL al bot para que la
// reenvíe al comensal.

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentConfigs, orderItems, orders, shifts, tableSessions, tenants } from "@/lib/db/schema";
import { type OrderPaymentMethod } from "@/lib/payment-methods";
import { queuePosReport } from "@/lib/pos-reports";
import { stripeClient } from "@/lib/stripe";
import { computeTotals as computeTotalsImpl } from "@/lib/tax/compute";

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
  /** 'dine_in' (comer aquí, requiere tableNumber) | 'takeaway' (llevar, requiere customerName).
   *  Default 'takeaway' por backward-compat. */
  orderType?: "dine_in" | "takeaway";
  customerPhone?: string;
  customerName?: string;
  tableNumber?: string;
  items: OrderItemInput[];
  notes?: string;
  /** Mig 029: true = pedido creado desde el playground (runtime sandbox=true).
   *  KDS filtra is_test=false por defecto; workers proactivos WA saltan estas filas. */
  isTest?: boolean;
};

export type OrderTotals = {
  subtotalCents: number;
  vatCents: number;
  totalCents: number;
};

/**
 * @deprecated wrapper legacy. Usa `lib/tax/compute.computeTotals` directamente.
 * Mantengo esta firma para no romper callers externos, pero ahora delega al
 * nuevo motor que respeta `pricesIncludeTax`. Asume PVP (tax-inclusive).
 */
export function computeTotals(items: OrderItemInput[], defaultTaxRate: number): OrderTotals {
  const r = computeTotalsImpl(
    items.map((i) => ({ quantity: i.quantity, unitPriceCents: i.unitPriceCents, taxRate: i.vatRate })),
    { pricesIncludeTax: true, defaultRate: defaultTaxRate },
  );
  return { subtotalCents: r.subtotalCents, vatCents: r.taxCents, totalCents: r.totalCents };
}

/** Crea un pedido en estado `pending` con sus líneas. Transaccional. */
export async function createOrder(input: CreateOrderInput) {
  const [tenant] = await db
    .select({
      taxRateStandard: tenants.taxRateStandard,
      pricesIncludeTax: tenants.pricesIncludeTax,
      taxLabel: tenants.taxLabel,
    })
    .from(tenants)
    .where(eq(tenants.id, input.tenantId))
    .limit(1);
  if (!tenant) throw new Error("tenant_not_found");

  const defaultRate = parseFloat(tenant.taxRateStandard ?? "10.00");
  const totals = computeTotalsImpl(
    input.items.map((i) => ({ quantity: i.quantity, unitPriceCents: i.unitPriceCents, taxRate: i.vatRate })),
    { pricesIncludeTax: tenant.pricesIncludeTax ?? true, defaultRate },
  );

  const orderType = input.orderType ?? "takeaway";

  // Mig 032: sesión de mesa. Para dine_in con tableNumber → resolvemos o
  // creamos la sesión activa y linkeamos el pedido. Para takeaway u órdenes
  // sin mesa, sessionId queda NULL (comportamiento legacy).
  let sessionId: string | null = null;
  if (orderType === "dine_in" && input.tableNumber) {
    sessionId = await getOrCreateActiveSession({
      tenantId: input.tenantId,
      tableNumber: input.tableNumber,
      isTest: input.isTest ?? false,
    });
  }

  // Mig 038 (POS): auto-vincular al turno abierto del tenant (si hay).
  // Pedidos de test NO se vinculan — no deben ensuciar los reportes POS.
  //
  // Mig 040: si NO hay turno abierto, auto-abrimos uno con opening_cash=0 y
  // mandamos WA al dueño (best-effort, no bloqueante). Así los "turnos
  // obligatorios" no rompen el servicio cuando el encargado se olvida.
  let shiftId: string | null = null;
  let shiftAutoOpened = false;
  if (!(input.isTest ?? false)) {
    const [openShift] = await db
      .select({ id: shifts.id })
      .from(shifts)
      .where(and(eq(shifts.tenantId, input.tenantId), isNull(shifts.closedAt)))
      .limit(1);
    if (openShift) {
      shiftId = openShift.id;
    } else {
      try {
        const [created] = await db
          .insert(shifts)
          .values({
            tenantId: input.tenantId,
            openingCashCents: 0,
            openedBy: "auto",
            autoOpened: true,
          })
          .returning({ id: shifts.id });
        shiftId = created?.id ?? null;
        shiftAutoOpened = shiftId !== null;
      } catch {
        // Race: otra transacción abrió justo ahora → rele.
        const [retry] = await db
          .select({ id: shifts.id })
          .from(shifts)
          .where(and(eq(shifts.tenantId, input.tenantId), isNull(shifts.closedAt)))
          .limit(1);
        shiftId = retry?.id ?? null;
      }
    }
  }

  const [order] = await db
    .insert(orders)
    .values({
      tenantId: input.tenantId,
      orderType,
      // Mig 027: pedidos nuevos arrancan en pending_kitchen_review hasta que la cocina
      // los acepta con ETA. Antes el default era 'pending' y se saltaba ese gate.
      status: "pending_kitchen_review",
      kitchenDecision: "pending",
      customerPhone: input.customerPhone,
      customerName: input.customerName,
      tableNumber: input.tableNumber,
      notes: input.notes,
      subtotalCents: totals.subtotalCents,
      // Durante la ventana de transición escribimos ambos iguales. vat_cents queda DEPRECATED.
      vatCents: totals.taxCents,
      taxCents: totals.taxCents,
      totalCents: totals.totalCents,
      currency: "EUR",
      // Mig 029: marca playground. Solo el runtime con x-internal-secret puede setear true.
      isTest: input.isTest ?? false,
      // Mig 032: link a sesión de mesa (NULL para takeaway).
      sessionId,
      // Mig 038: link al turno POS abierto (NULL si no hay turno o es test).
      shiftId,
    })
    .returning();

  // Mig 032: recalcular total de la sesión con la suma denormalizada.
  if (sessionId) {
    await db
      .update(tableSessions)
      .set({
        totalCents: sql`${tableSessions.totalCents} + ${totals.totalCents}`,
        updatedAt: new Date(),
      })
      .where(eq(tableSessions.id, sessionId));
  }

  if (input.items.length > 0) {
    await db.insert(orderItems).values(
      input.items.map((it) => {
        const lineTotal = it.quantity * it.unitPriceCents;
        const rateStr = String((it.vatRate ?? defaultRate).toFixed(2));
        return {
          orderId: order.id,
          tenantId: input.tenantId,
          name: it.name,
          quantity: it.quantity,
          unitPriceCents: it.unitPriceCents,
          // Doble escritura durante transición. Cuando droppemos vat_rate (migración 010+),
          // quedará solo taxRate.
          vatRate: rateStr,
          taxRate: rateStr,
          taxLabel: tenant.taxLabel ?? "IVA",
          lineTotalCents: lineTotal,
          notes: it.notes,
        };
      }),
    );
  }

  // Mig 040: si acabamos de auto-abrir el turno, avisamos al dueño por WA.
  // Fire-and-forget — si el WA falla o no hay destinatario, el pedido
  // sigue creándose normal.
  if (shiftAutoOpened) {
    const panelBase = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "https://ordychat.com";
    queuePosReport(input.tenantId, "shift_auto_opened", {
      openedAt: new Date(),
      panelUrl: `${panelBase.replace(/\/$/, "")}/dashboard/turno`,
    });
  }

  return order;
}

/**
 * Mig 032: resuelve la sesión activa de (tenant, table_number) o crea una
 * nueva. "Activa" = status NO en (paid, closed). La constraint partial-unique
 * a nivel DB garantiza que solo hay UNA. Si el caller intenta crear y ya
 * existe (race), hacemos el SELECT y devolvemos la existente.
 *
 * Nota: is_test se propaga del pedido. Una mesa con una sesión is_test=true
 * abierta + un pedido real daría problemas, pero en la práctica eso solo
 * pasa en playground donde el tenant ya sabe lo que hace.
 */
export async function getOrCreateActiveSession(input: {
  tenantId: string;
  tableNumber: string;
  isTest?: boolean;
}): Promise<string> {
  // Mig 032 + Fase 6: solo reusamos sesión si está 'pending' o 'active'.
  // En 'billing' (el cliente ya pidió la cuenta) bloqueamos nuevos pedidos
  // para evitar: cliente paga X € en Stripe, al mismo tiempo añaden un
  // plato que sube el total → descuadre. Si el cliente quiere algo más
  // tras pedir cuenta, el camarero lo añade a mano o se abre sesión nueva.
  const existing = await db
    .select({ id: tableSessions.id, status: tableSessions.status })
    .from(tableSessions)
    .where(
      and(
        eq(tableSessions.tenantId, input.tenantId),
        eq(tableSessions.tableNumber, input.tableNumber),
        inArray(tableSessions.status, ["pending", "active", "billing"]),
      ),
    )
    .limit(1);
  if (existing.length > 0) {
    if (existing[0].status === "billing") {
      // Surface explícito al caller — el runtime lo tradurá a un mensaje
      // al cliente del estilo "la cuenta ya se pidió, avisa al camarero si
      // quieres añadir algo más".
      throw new Error("session_in_billing");
    }
    return existing[0].id;
  }

  // Crear. Si hay race con otra transacción creando justo, el unique partial
  // nos rechaza; entonces releeemos.
  try {
    const [created] = await db
      .insert(tableSessions)
      .values({
        tenantId: input.tenantId,
        tableNumber: input.tableNumber,
        status: "pending",
        isTest: input.isTest ?? false,
      })
      .returning({ id: tableSessions.id });
    return created.id;
  } catch {
    const [after] = await db
      .select({ id: tableSessions.id, status: tableSessions.status })
      .from(tableSessions)
      .where(
        and(
          eq(tableSessions.tenantId, input.tenantId),
          eq(tableSessions.tableNumber, input.tableNumber),
          inArray(tableSessions.status, ["pending", "active", "billing"]),
        ),
      )
      .limit(1);
    if (!after) throw new Error("session_insert_race_unresolvable");
    if (after.status === "billing") throw new Error("session_in_billing");
    return after.id;
  }
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
    line_items: lines.map((ln) => ({
      // unitPriceCents ya es el PVP final al cliente (con tax si el tenant tiene
      // pricesIncludeTax=true). NO añadimos tax encima — eso causaría double-tax.
      price_data: {
        currency: order.currency.toLowerCase(),
        product_data: {
          name: ln.name,
          ...(ln.notes ? { description: ln.notes } : {}),
        },
        unit_amount: ln.unitPriceCents,
      },
      quantity: ln.quantity,
    })),
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
 *
 * Mig 039: si el caller no pasa `paymentMethod`, asumimos 'card' (el único
 * flujo que llega aquí es Stripe Checkout online → tarjeta). El cierre de
 * turno filtra cash vs. resto para el cuadre de caja.
 */
export async function markOrderPaidBySession(
  sessionId: string,
  paymentIntentId?: string,
  paymentMethod: OrderPaymentMethod = "card",
) {
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
      paymentMethod,
      updatedAt: new Date(),
    })
    .where(eq(orders.id, order.id))
    .returning();
  return updated;
}

/**
 * Marca una orden arbitraria como pagada (uso del dashboard/KDS manual, no
 * Stripe). El caller provee el método — default 'cash' para que el flujo
 * clásico "camarero cobra en caja" no requiera un tap extra.
 * Valida ownership del tenant. Idempotente: si ya está paid, no toca.
 */
export async function markOrderPaidManual(
  orderId: string,
  tenantId: string,
  paymentMethod: OrderPaymentMethod = "cash",
) {
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)))
    .limit(1);
  if (!order) return null;
  if (order.status === "paid") {
    // Si ya está paid pero nos pasan un método diferente → actualizar el
    // método (admin quiso corregir). NO tocar paidAt para preservar timeline.
    if (paymentMethod !== order.paymentMethod) {
      const [updated] = await db
        .update(orders)
        .set({ paymentMethod, updatedAt: new Date() })
        .where(eq(orders.id, order.id))
        .returning();
      return updated;
    }
    return order;
  }

  const [updated] = await db
    .update(orders)
    .set({
      status: "paid",
      paidAt: new Date(),
      paymentMethod,
      updatedAt: new Date(),
    })
    .where(eq(orders.id, order.id))
    .returning();
  return updated;
}
