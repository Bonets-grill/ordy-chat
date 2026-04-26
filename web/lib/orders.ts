// web/lib/orders.ts — Lógica de negocio de pedidos del mesero digital.
//
// Un pedido se crea desde el runtime (bot WhatsApp detectó intent "pedir") o
// desde un endpoint interno (panel/POS en el futuro). Al crearse se calculan
// subtotales, IVA y total en céntimos. Al generar el cobro, web crea un Stripe
// Checkout Session dedicated a esa orden y devuelve la URL al bot para que la
// reenvíe al comensal.

import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentConfigs, menuItems, modifierOptions, orderItems, orders, shifts, tableSessions, tenants } from "@/lib/db/schema";
import { type OrderPaymentMethod } from "@/lib/payment-methods";
import { queuePosReport } from "@/lib/pos-reports";
import { isWithinSchedule } from "@/lib/schedule";
import { stripeClient } from "@/lib/stripe";
import { computeTotals as computeTotalsImpl } from "@/lib/tax/compute";

/** Error cuando se intenta crear un pedido fuera del horario de apertura. */
export class OutOfHoursError extends Error {
  readonly code = "out_of_hours" as const;
  constructor(public readonly schedule: string) {
    super(`out_of_hours: el restaurante está cerrado ahora (schedule: ${schedule.slice(0, 80)})`);
    this.name = "OutOfHoursError";
  }
}

/** Error cuando se detecta un pedido idéntico recién creado (idempotency guard). */
export class DuplicateOrderError extends Error {
  readonly code = "duplicate_order" as const;
  constructor(public readonly existingOrderId: string) {
    super(`duplicate_order: order ${existingOrderId} ya existe en últimos 60s con mismo contenido`);
    this.name = "DuplicateOrderError";
  }
}

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
  /** true = pedido creado por staff (comandero/POS interno). El staff sabe
   *  que el local está abierto físicamente — saltamos guard horario y
   *  guard idempotency (un mesero PUEDE legítimamente crear 2 pedidos
   *  iguales para 2 mesas distintas). */
  bypassGuards?: boolean;
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
      timezone: tenants.timezone,
    })
    .from(tenants)
    .where(eq(tenants.id, input.tenantId))
    .limit(1);
  if (!tenant) throw new Error("tenant_not_found");

  // GUARD HORARIO (bug Bonets 2026-04-26): el bot creó pedido a las 23:06
  // sábado cuando el restaurante cerraba 23:00. Ahora server-side rechaza
  // pedidos fuera del horario declarado en agent_configs.schedule.
  //
  // EXCEPCIONES (no aplican guard):
  //   - is_test (playground sandbox)
  //   - bypassGuards (comandero/POS interno — el staff sabe si está abierto)
  if (!(input.isTest ?? false) && !(input.bypassGuards ?? false)) {
    const [cfg] = await db
      .select({ schedule: agentConfigs.schedule })
      .from(agentConfigs)
      .where(eq(agentConfigs.tenantId, input.tenantId))
      .limit(1);
    const status = isWithinSchedule(cfg?.schedule, new Date(), tenant.timezone ?? "Atlantic/Canary");
    if (!status.open) {
      throw new OutOfHoursError(status.schedule);
    }
  }

  // GUARD IDEMPOTENCY (bug Bonets 2026-04-26): el LLM ejecutó crear_pedido
  // 2x en la misma sesión de Bradly → 2 pedidos idénticos en la DB. Si en
  // los últimos 60s ya existe un pedido del mismo customer_phone con el
  // mismo total_cents calculado, lo devolvemos en vez de crear duplicado.
  // Solo aplica con customerPhone (no para test playground sin phone real)
  // y NO para staff interno (comandero puede crear 2 pedidos = 2 mesas).
  if (input.customerPhone && !(input.isTest ?? false) && !(input.bypassGuards ?? false)) {
    const sinceTs = new Date(Date.now() - 60_000);
    const recents = await db
      .select({
        id: orders.id,
        totalCents: orders.totalCents,
        status: orders.status,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .where(
        and(
          eq(orders.tenantId, input.tenantId),
          eq(orders.customerPhone, input.customerPhone),
          gt(orders.createdAt, sinceTs),
        ),
      )
      .orderBy(desc(orders.createdAt))
      .limit(5);
    // Calculamos el total previsto del nuevo input (sin modifiers detallados aún)
    // sumando precios+cantidad. Aproximación suficiente para detectar duplicado.
    const previewTotal = input.items.reduce(
      (acc, it) => acc + it.unitPriceCents * it.quantity +
        (it.modifiers ?? []).reduce((mAcc, m) => mAcc + m.priceDeltaCents * it.quantity, 0),
      0,
    );
    // Permitimos ±5% de tolerancia por redondeo IVA. Si total y nº items
    // coinciden con un order recién creado del mismo phone → duplicado.
    const dup = recents.find((r) => {
      if (r.status === "canceled") return false;
      const delta = Math.abs(r.totalCents - previewTotal);
      return delta < Math.max(50, Math.round(previewTotal * 0.05));
    });
    if (dup) {
      throw new DuplicateOrderError(dup.id);
    }
  }

  const defaultRate = parseFloat(tenant.taxRateStandard ?? "10.00");

  // Mig 042: el unitPrice efectivo incluye los deltas de los modifiers
  // seleccionados. Lo calculamos una sola vez aquí y reutilizamos para tax,
  // line_total y persistencia. Filtramos modifiers con priceDeltaCents<0 por
  // defensa-en-profundidad (la DB ya lo bloquea con CHECK).
  //
  // Mig 048 dual-language: el cliente puede pasar el modifier `name` en su
  // idioma (ej "Extra cheese"). NO confiamos en eso — resolvemos el nombre
  // CANÓNICO en español desde DB usando el modifierId. El KDS solo entiende
  // español. Misma defensa para priceDeltaCents (anti-tampering).
  const allModifierIds = Array.from(
    new Set(
      input.items.flatMap((i) => (i.modifiers ?? []).map((m) => m.modifierId)),
    ),
  );
  let dbMods: Array<{ id: string; groupId: string; name: string; priceDeltaCents: number }> = [];
  if (allModifierIds.length) {
    try {
      // Mig 051: lookup canónico desde la biblioteca (modifier_options).
      // El KDS sigue solo entendiendo español → name canónico ES.
      const raw = await db
        .select({
          id: modifierOptions.id,
          groupId: modifierOptions.groupId,
          name: modifierOptions.name,
          priceDeltaCents: modifierOptions.priceDeltaCents,
        })
        .from(modifierOptions)
        .where(inArray(modifierOptions.id, allModifierIds));
      if (Array.isArray(raw)) dbMods = raw;
    } catch {
      // Defensive: si el lookup falla, caemos a client data.
    }
  }
  const modById = new Map(dbMods.map((m) => [m.id, m]));

  const itemsAdjusted = input.items.map((i) => {
    const canonicalMods = (i.modifiers ?? [])
      .map((m) => {
        const dbm = modById.get(m.modifierId);
        // Si el modifier está en DB → usamos canónico (name ES + price defensivo).
        // Si NO está (legacy data, test, ID desconocido) → usamos lo que pasó el cliente.
        return dbm
          ? {
              groupId: dbm.groupId,
              modifierId: dbm.id,
              name: dbm.name,
              priceDeltaCents: dbm.priceDeltaCents,
            }
          : {
              groupId: m.groupId,
              modifierId: m.modifierId,
              name: m.name,
              priceDeltaCents: m.priceDeltaCents,
            };
      })
      .filter((m) => m.priceDeltaCents >= 0);
    const modsTotal = canonicalMods.reduce((acc, m) => acc + m.priceDeltaCents, 0);
    return {
      ...i,
      modifiers: canonicalMods,
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

  // 2026-04-25 fix: el driver neon-http NO soporta db.transaction() — antes
  // este bloque envolvía stock check + INSERT order + INSERT order_items en
  // una transacción, pero ese código tiraba "No transactions support in
  // neon-http driver" → 500 desde /api/orders en cada crear_pedido del bot.
  // Mismo patrón que el fix 1e6dc88 sobre menu_item_modifiers.
  //
  // Riesgo aceptado: si un INSERT falla a mitad (ej. order creado pero
  // order_items truena), queda un pedido huérfano sin líneas. En la práctica
  // raro porque el INSERT de orders es el de mayor riesgo (FK sessionId,
  // shiftId) y order_items son simples INSERTs por valor. El cron que limpia
  // sesiones también limpia órdenes huérfanas pasadas las 24h.
  const order = await (async () => {
    // 1) Stock check + decremento atómico por item gestionado.
    if (itemNames.length > 0) {
      const managed = await db
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

        // Atomic check-and-decrement: WHERE stock_qty >= requested protege
        // frente a races (otro pedido en paralelo). Si vuelve 0 filas →
        // out_of_stock. Sin transacción esta protección sigue válida porque
        // cada UPDATE es atómico a nivel de fila en Postgres.
        const updated = await db
          .update(menuItems)
          .set({
            stockQty: sql`${menuItems.stockQty} - ${requested}`,
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
          throw new OutOfStockError([
            { name: m.name, requested, available: m.stockQty },
          ]);
        }

        const newStock = updated[0].stockQty ?? 0;
        const threshold = updated[0].lowStockThreshold;
        const lastAlert = updated[0].lastLowStockAlertAt;

        if (threshold != null && newStock <= threshold) {
          const cooldownMs = 60 * 60 * 1000; // 1h
          const now = Date.now();
          const lastMs = lastAlert ? new Date(lastAlert).getTime() : 0;
          if (now - lastMs >= cooldownMs) {
            await db
              .update(menuItems)
              .set({ lastLowStockAlertAt: new Date(now) })
              .where(eq(menuItems.id, m.id));
            lowStockAlerts.push({ name: m.name, stockQty: newStock, threshold });
          }
        }
      }
    }

    // 2) INSERT order
    const [orderRow] = await db
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
      await db
        .update(tableSessions)
        .set({
          totalCents: sql`${tableSessions.totalCents} + ${totals.totalCents}`,
          updatedAt: new Date(),
        })
        .where(eq(tableSessions.id, sessionId));
    }

    // 4) INSERT order_items con precios ajustados por modifiers (mig 042).
    if (itemsAdjusted.length > 0) {
      await db.insert(orderItems).values(
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

    return orderRow;
  })();

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
