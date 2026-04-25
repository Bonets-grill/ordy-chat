// web/lib/orders.ts — Lógica de negocio de pedidos del mesero digital.
//
// Un pedido se crea desde el runtime (bot WhatsApp detectó intent "pedir") o
// desde un endpoint interno (panel/POS en el futuro). Al crearse se calculan
// subtotales, IVA y total en céntimos. Al generar el cobro, web crea un Stripe
// Checkout Session dedicated a esa orden y devuelve la URL al bot para que la
// reenvíe al comensal.

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentConfigs, menuItems, orderItems, orders, shifts, tableSessions, tenants } from "@/lib/db/schema";
import { type OrderPaymentMethod } from "@/lib/payment-methods";
import { queuePosReport } from "@/lib/pos-reports";
import { stripeClient } from "@/lib/stripe";
import { computeTotals as computeTotalsImpl } from "@/lib/tax/compute";

/**
 * Mig 044: error que lanza createOrder cuando algún item del pedido no tiene
 * stock suficiente. El runtime traduce esto a un mensaje al cliente del estilo
 * "Ya no nos quedan X". El caller puede leer .items para saber qué faltó.
 */
export class OutOfStockError extends Error {
  readonly code = "out_of_stock" as const;
  readonly items: Array<{ name: string; requested: number; available: number }>;
  constructor(items: Array<{ name: string; requested: number; available: number }>) {
    super(
      `out_of_stock: ${items.map((i) => `${i.name} (pedidos ${i.requested}, quedan ${i.available})`).join(", ")}`,
    );
    this.name = "OutOfStockError";
    this.items = items;
  }
}

export type OrderItemInput = {
  name: string;
  quantity: number;
  /** Precio unitario SIN modifiers, en céntimos. createOrder le suma los deltas. */
  unitPriceCents: number;
  /** Tipo de IVA. Si se omite, usa el default del tenant. */
  vatRate?: number;
  notes?: string;
  /**
   * Mig 042: modifiers seleccionados por el cliente. La suma de
   * priceDeltaCents se añade a unitPriceCents antes de calcular tax y total.
   * Persistido como snapshot en order_items.modifiersJson.
   */
  modifiers?: Array<{
    groupId: string;
    modifierId: string;
    name: string;
    priceDeltaCents: number;
  }>;
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
  /** Metadata libre persistida en orders.metadata (jsonb). El comandero usa
   *  { created_by_waiter_id: userId } para reportes por mesero. */
  metadata?: Record<string, unknown>;
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

  // Mig 042: el unitPrice efectivo incluye los deltas de los modifiers
  // seleccionados. Lo calculamos una sola vez aquí y reutilizamos para tax,
  // line_total y persistencia. Filtramos modifiers con priceDeltaCents<0 por
  // defensa-en-profundidad (la DB ya lo bloquea con CHECK).
  const itemsAdjusted = input.items.map((i) => {
    const safeMods = (i.modifiers ?? []).filter((m) => m.priceDeltaCents >= 0);
    const modsTotal = safeMods.reduce((acc, m) => acc + m.priceDeltaCents, 0);
    return {
      ...i,
      modifiers: safeMods,
      unitPriceCentsAdjusted: i.unitPriceCents + modsTotal,
    };
  });

  const totals = computeTotalsImpl(
    itemsAdjusted.map((i) => ({
      quantity: i.quantity,
      unitPriceCents: i.unitPriceCentsAdjusted,
      taxRate: i.vatRate,
    })),
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

  // Mig 044: agregamos cantidad por nombre para el caso de líneas duplicadas
  // del mismo plato (poco común pero posible). El decremento usa el total.
  const itemQtyByName = new Map<string, number>();
  for (const it of input.items) {
    const key = it.name;
    itemQtyByName.set(key, (itemQtyByName.get(key) ?? 0) + it.quantity);
  }
  const itemNames = [...itemQtyByName.keys()];

  // Buffer de alertas de stock bajo a disparar tras el commit. Lo llenamos
  // dentro de la transacción y lo procesamos fuera (fire-and-forget).
  type LowStockAlert = { name: string; stockQty: number; threshold: number };
  const lowStockAlerts: LowStockAlert[] = [];

  // Transacción: stock check + decremento + INSERT order + INSERT order_items
  // van juntos. Si cualquier paso falla, ROLLBACK y NO se crea el pedido.
  // Mig 044.
  const { order } = await db.transaction(async (tx) => {
    // 1) Stock check + decremento atómico por item gestionado.
    //    UPDATE ... WHERE stock_qty >= qty RETURNING — si vuelve 0 filas para
    //    un item con stock_qty NOT NULL → out_of_stock (carrera o stock bajo).
    //    Para items con stock_qty IS NULL no tocamos nada (ilimitado).
    if (itemNames.length > 0) {
      const managed = await tx
        .select({
          id: menuItems.id,
          name: menuItems.name,
          stockQty: menuItems.stockQty,
          lowStockThreshold: menuItems.lowStockThreshold,
          lastLowStockAlertAt: menuItems.lastLowStockAlertAt,
        })
        .from(menuItems)
        .where(
          and(
            eq(menuItems.tenantId, input.tenantId),
            inArray(menuItems.name, itemNames),
          ),
        );

      // Pre-check determinístico: cualquier managed con stock_qty < requested
      // → rechaza ya con el conjunto completo de items afectados.
      const insufficient: Array<{ name: string; requested: number; available: number }> = [];
      for (const m of managed) {
        if (m.stockQty == null) continue;
        const requested = itemQtyByName.get(m.name) ?? 0;
        if (requested > m.stockQty) {
          insufficient.push({ name: m.name, requested, available: m.stockQty });
        }
      }
      if (insufficient.length > 0) {
        throw new OutOfStockError(insufficient);
      }

      // Decremento + auto-disable cuando llega a 0. Una UPDATE por item para
      // poder leer el resultado y decidir alerta. Cooldown de 1h en la alerta
      // se evalúa con lastLowStockAlertAt.
      for (const m of managed) {
        if (m.stockQty == null) continue;
        const requested = itemQtyByName.get(m.name) ?? 0;
        if (requested === 0) continue;

        // Atomic check-and-decrement: la cláusula WHERE stock_qty >= requested
        // protege frente a races (otro pedido entró en paralelo). Si vuelve 0
        // filas ya no hay stock → out_of_stock.
        const updated = await tx
          .update(menuItems)
          .set({
            stockQty: sql`${menuItems.stockQty} - ${requested}`,
            // Cuando llegamos a 0 marcamos available=false. > 0 no toca el flag
            // (el dueño puede haber forzado available=false manual).
            available: sql`CASE WHEN ${menuItems.stockQty} - ${requested} <= 0 THEN false ELSE ${menuItems.available} END`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(menuItems.id, m.id),
              eq(menuItems.tenantId, input.tenantId),
              sql`${menuItems.stockQty} >= ${requested}`,
            ),
          )
          .returning({
            stockQty: menuItems.stockQty,
            lowStockThreshold: menuItems.lowStockThreshold,
            lastLowStockAlertAt: menuItems.lastLowStockAlertAt,
          });

        if (updated.length === 0) {
          // Race perdida: otro pedido se llevó las últimas unidades entre el
          // pre-check y el UPDATE. Tratamos como out_of_stock.
          throw new OutOfStockError([
            { name: m.name, requested, available: m.stockQty },
          ]);
        }

        const newStock = updated[0].stockQty ?? 0;
        const threshold = updated[0].lowStockThreshold;
        const lastAlert = updated[0].lastLowStockAlertAt;

        // Alerta WA si el threshold está configurado y stock cae <= threshold,
        // con cooldown de 1h sobre el last alert. Marcamos last_low_stock_alert_at
        // dentro de la misma tx para evitar carreras del propio cron de alertas.
        if (threshold != null && newStock <= threshold) {
          const cooldownMs = 60 * 60 * 1000; // 1h
          const now = Date.now();
          const lastMs = lastAlert ? new Date(lastAlert).getTime() : 0;
          if (now - lastMs >= cooldownMs) {
            await tx
              .update(menuItems)
              .set({ lastLowStockAlertAt: new Date(now) })
              .where(eq(menuItems.id, m.id));
            lowStockAlerts.push({ name: m.name, stockQty: newStock, threshold });
          }
        }
      }
    }

    // 2) INSERT order
    const [orderRow] = await tx
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
        // Comandero: { created_by_waiter_id: userId } para reportes por mesero.
        ...(input.metadata ? { metadata: input.metadata } : {}),
      })
      .returning();

    // 3) Recalcular total de la sesión con la suma denormalizada (mig 032).
    if (sessionId) {
      await tx
        .update(tableSessions)
        .set({
          totalCents: sql`${tableSessions.totalCents} + ${totals.totalCents}`,
          updatedAt: new Date(),
        })
        .where(eq(tableSessions.id, sessionId));
    }

    // 4) INSERT order_items con precios ajustados por modifiers (mig 042).
    if (itemsAdjusted.length > 0) {
      await tx.insert(orderItems).values(
        itemsAdjusted.map((it) => {
          // unit_price_cents incluye ya el delta de modifiers (mig 042).
          const lineTotal = it.quantity * it.unitPriceCentsAdjusted;
          const rateStr = String((it.vatRate ?? defaultRate).toFixed(2));
          return {
            orderId: orderRow.id,
            tenantId: input.tenantId,
            name: it.name,
            quantity: it.quantity,
            unitPriceCents: it.unitPriceCentsAdjusted,
            // Doble escritura durante transición. Cuando droppemos vat_rate (migración 010+),
            // quedará solo taxRate.
            vatRate: rateStr,
            taxRate: rateStr,
            taxLabel: tenant.taxLabel ?? "IVA",
            lineTotalCents: lineTotal,
            notes: it.notes,
            // Mig 042: snapshot de modifiers para que el KDS / recibo / dashboard
            // los muestren sin joinar y sobrevivan al borrado posterior.
            modifiersJson: it.modifiers,
          };
        }),
      );
    }

    return { order: orderRow };
  });

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

  // Mig 044: alertas de stock bajo. No bloqueante. Una alerta WA por item.
  // Pedidos test (playground) NO disparan alertas — ensucian al admin.
  if (!(input.isTest ?? false)) {
    for (const a of lowStockAlerts) {
      queuePosReport(input.tenantId, "low_stock", {
        name: a.name,
        stockQty: a.stockQty,
        threshold: a.threshold,
      });
    }
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

/**
 * Marca una orden como pagada vía Stripe Terminal (mig 045).
 * El webhook payment_intent.succeeded la invoca con el PaymentIntent.id.
 *
 * - Si la orden tiene tenant_id distinto al que metadata dice, abortamos.
 * - Si ya está paid, idempotente (no toca paidAt).
 * - paymentMethod siempre 'card' (Stripe Terminal solo procesa card_present).
 */
export async function markOrderPaidByPaymentIntent(
  paymentIntentId: string,
  tenantId: string,
  orderId: string,
) {
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId)))
    .limit(1);
  if (!order) return null;
  if (order.status === "paid") return order;

  const [updated] = await db
    .update(orders)
    .set({
      status: "paid",
      paidAt: new Date(),
      paymentMethod: "card",
      stripePaymentIntentId: paymentIntentId,
      updatedAt: new Date(),
    })
    .where(eq(orders.id, order.id))
    .returning();
  return updated;
}
