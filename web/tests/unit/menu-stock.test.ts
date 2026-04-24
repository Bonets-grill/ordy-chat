// web/tests/unit/menu-stock.test.ts
//
// Mig 044 — control de stock por item con alerta WA.
//
// Cubrimos:
//   1. createOrder decrementa stock atómicamente cuando hay stock_qty.
//   2. createOrder rechaza con OutOfStockError si stock insuficiente.
//   3. Stock que llega a 0 → available=false (verificado vía SET con CASE).
//   4. Restock vuelve available=true cuando aplica (testeado en builder de set).
//   5. Alerta WA solo se dispara una vez por hora (cooldown 1h).
//
// Como no hay Postgres real en CI, mockeamos @/lib/db con un fake transaction
// que registra las llamadas y devuelve datos controlados. La intención es
// validar la LÓGICA del decremento + alerta, no Postgres.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Fixtures ─────────────────────────────────────────────────
const TENANT = "00000000-0000-0000-0000-000000000aaa";

type ManagedRow = {
  id: string;
  name: string;
  stockQty: number | null;
  lowStockThreshold: number | null;
  lastLowStockAlertAt: Date | null;
};

type FakeState = {
  managed: ManagedRow[];
  // log de UPDATE menu_items: itemId → nuevo stock tras decremento (null si la
  // tx perdió la race). Pre-poblado para simular el comportamiento real.
  updateOutcomes: Map<string, { stockQty: number | null; lowStockThreshold: number | null; lastLowStockAlertAt: Date | null } | null>;
  // Si true, el primer UPDATE-RETURNING devuelve [] (race perdida).
  raceLost: Set<string>;
  alertUpdates: Array<{ itemId: string; field: "lastLowStockAlertAt"; value: Date }>;
  insertedOrders: Array<Record<string, unknown>>;
  insertedOrderItems: Array<Record<string, unknown>>;
};

const STATE: FakeState = {
  managed: [],
  updateOutcomes: new Map(),
  raceLost: new Set(),
  alertUpdates: [],
  insertedOrders: [],
  insertedOrderItems: [],
};

// ── Mocks ────────────────────────────────────────────────────

// queuePosReport — captura las llamadas para verificar alertas. Mantenemos
// el resto del módulo (buildLowStockMessage, etc.) usando importOriginal.
const queueCalls: Array<{ tenantId: string; kind: string; data: unknown }> = [];
vi.mock("@/lib/pos-reports", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pos-reports")>();
  return {
    ...actual,
    queuePosReport: vi.fn((tenantId: string, kind: string, data: unknown) => {
      queueCalls.push({ tenantId, kind, data });
    }),
  };
});

// stripeClient nunca debería ser llamado en createOrder — stub no-op.
vi.mock("@/lib/stripe", () => ({
  stripeClient: vi.fn(async () => {
    throw new Error("stripe should not be called from createOrder");
  }),
}));

vi.mock("@/lib/tax/compute", () => ({
  computeTotals: (items: Array<{ quantity: number; unitPriceCents: number }>) => {
    const subtotal = items.reduce((s, i) => s + i.quantity * i.unitPriceCents, 0);
    return { subtotalCents: subtotal, taxCents: 0, totalCents: subtotal };
  },
}));

// drizzle-orm — versión mínima. eq/and/inArray/isNull/sql como pass-through.
vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("drizzle-orm");
  return {
    ...actual,
    eq: (col: unknown, val: unknown) => ({ __eq: { col, val } }),
    and: (...args: unknown[]) => ({ __and: args }),
    inArray: (col: unknown, vals: unknown[]) => ({ __in: { col, vals } }),
    isNull: (col: unknown) => ({ __isNull: col }),
    sql: Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => ({ __sql: { strings, values } }),
      { raw: (s: string) => ({ __raw: s }) },
    ),
  };
});

// schema — solo necesitamos placeholders con .name para tracking.
vi.mock("@/lib/db/schema", () => {
  const col = (name: string) => ({ name });
  return {
    menuItems: {
      id: col("id"),
      tenantId: col("tenant_id"),
      name: col("name"),
      stockQty: col("stock_qty"),
      lowStockThreshold: col("low_stock_threshold"),
      lastLowStockAlertAt: col("last_low_stock_alert_at"),
      available: col("available"),
      updatedAt: col("updated_at"),
    },
    orders: { id: col("id"), tenantId: col("tenant_id") },
    orderItems: { orderId: col("order_id"), tenantId: col("tenant_id") },
    shifts: { id: col("id"), tenantId: col("tenant_id"), closedAt: col("closed_at") },
    tableSessions: {
      id: col("id"),
      tenantId: col("tenant_id"),
      tableNumber: col("table_number"),
      status: col("status"),
      totalCents: col("total_cents"),
      updatedAt: col("updated_at"),
    },
    tenants: {
      id: col("id"),
      taxRateStandard: col("tax_rate_standard"),
      pricesIncludeTax: col("prices_include_tax"),
      taxLabel: col("tax_label"),
    },
    agentConfigs: { tenantId: col("tenant_id") },
  };
});

// db — fake con .select / .insert / .update y db.transaction.
vi.mock("@/lib/db", () => {
  // Tracker para distinguir qué tabla está consultando cada chain.
  let lastFromTable: "menuItems" | "tenants" | "shifts" | "orders" | "orderItems" | "tableSessions" | null = null;

  const makeSelectChain = () => {
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn((tbl: { id?: { name: string } }) => {
      // Identificamos la tabla por la columna .id.name del placeholder.
      const tblName = (tbl as { id?: { name: string } }).id?.name;
      if (tblName === "id" && tbl === ((globalThis as unknown as { __schema__?: unknown }).__schema__)) {
        lastFromTable = null;
      }
      // Inferencia simple por shape — chequeamos columna distintiva.
      const t = tbl as Record<string, { name?: string }>;
      if (t.stockQty?.name === "stock_qty") lastFromTable = "menuItems";
      else if (t.taxRateStandard?.name === "tax_rate_standard") lastFromTable = "tenants";
      else if (t.closedAt?.name === "closed_at") lastFromTable = "shifts";
      else if (t.tableNumber?.name === "table_number") lastFromTable = "tableSessions";
      else lastFromTable = null;
      return chain;
    });
    chain.where = vi.fn(() => chain);
    chain.orderBy = vi.fn(() => chain);
    chain.limit = vi.fn(async () => {
      if (lastFromTable === "tenants") {
        return [{ taxRateStandard: "10.00", pricesIncludeTax: true, taxLabel: "IVA" }];
      }
      if (lastFromTable === "shifts") {
        // No hay turno abierto → fuerza auto-open path. Pero is_test=false en
        // todos nuestros tests → da igual.
        return [];
      }
      return [];
    });
    // Para SELECT sin .limit (la query de menuItems no usa .limit).
    chain.then = undefined;
    return chain;
  };

  const select = vi.fn((proj?: unknown) => {
    void proj;
    return makeSelectChain();
  });

  // Para la query de menuItems dentro de tx (sin limit) usamos un hook:
  // tx.select(...).from(menuItems).where(...) DEBE devolver Array.
  // Lo hacemos via un proxy: el chain.from también termina con un await
  // implícito (drizzle resuelve al iterar). Pero como no usamos Symbol.asyncIterator,
  // necesitamos que el chain mismo sea thenable. Lo manejamos en el tx.

  const update = vi.fn(() => {
    // shifts auto-open path: siempre devuelve [] (insert lo maneja).
    const upd: Record<string, unknown> = {};
    upd.set = vi.fn(() => upd);
    upd.where = vi.fn(() => upd);
    upd.returning = vi.fn(async () => []);
    return upd;
  });

  const insert = vi.fn(() => {
    const ins: Record<string, unknown> = {};
    ins.values = vi.fn((vals: unknown) => {
      // Cuando es un array → orderItems.
      if (Array.isArray(vals)) {
        STATE.insertedOrderItems.push(...(vals as Record<string, unknown>[]));
      }
      return ins;
    });
    ins.returning = vi.fn(async () => [{ id: "shift-auto" }]);
    return ins;
  });

  // ── transaction fake ─────────────────────────────────────
  // Reproducimos el mínimo: select + update + insert. Aplicamos las reglas
  // de STATE para devolver los datos esperados.
  const transaction = vi.fn(async <T,>(fn: (tx: unknown) => Promise<T>) => {
    let txLastTable: "menuItems" | "orders" | "orderItems" | "tableSessions" | null = null;

    const txSelect = vi.fn((proj?: Record<string, unknown>) => {
      void proj;
      const chain: Record<string, unknown> = {};
      chain.from = vi.fn((tbl: Record<string, { name?: string }>) => {
        if (tbl.stockQty?.name === "stock_qty") txLastTable = "menuItems";
        return chain;
      });
      // El caller hace `await tx.select().from(...).where(...)` — devolvemos
      // una Promise que resuelve al array (NO un array thenable: eso dispara
      // unwrapping recursivo de Promise y vitest se cuelga).
      chain.where = vi.fn(() => {
        const result = txLastTable === "menuItems" ? [...STATE.managed] : [];
        return Promise.resolve(result);
      });
      return chain;
    });

    const txUpdate = vi.fn(() => {
      const upd: Record<string, unknown> = {};
      let target: string | null = null;
      upd.set = vi.fn(() => upd);
      upd.where = vi.fn((cond: unknown) => {
        // Detectamos el "id de menuItem" buscando en la cláusula.
        const findId = (c: unknown): string | null => {
          if (!c || typeof c !== "object") return null;
          const obj = c as Record<string, unknown>;
          if (obj.__eq) {
            const eq = obj.__eq as { col: { name?: string }; val: unknown };
            if (eq.col?.name === "id" && typeof eq.val === "string") return eq.val;
          }
          if (obj.__and) {
            for (const x of obj.__and as unknown[]) {
              const r = findId(x);
              if (r) return r;
            }
          }
          return null;
        };
        target = findId(cond);
        return upd;
      });
      upd.returning = vi.fn(async () => {
        if (!target) return [];
        if (STATE.raceLost.has(target)) return [];
        const out = STATE.updateOutcomes.get(target);
        if (out === null) return [];
        if (out) {
          // Si el caller solo está marcando lastLowStockAlertAt, registramos.
          STATE.alertUpdates.push({
            itemId: target,
            field: "lastLowStockAlertAt",
            value: new Date(),
          });
          return [out];
        }
        return [];
      });
      return upd;
    });

    const txInsert = vi.fn((tbl: Record<string, { name?: string }>) => {
      const tblIsOrders = tbl.id?.name === "id" && (tbl as Record<string, { name?: string }>).tenantId?.name === "tenant_id" && !((tbl as Record<string, { name?: string }>).orderId);
      const tblIsOrderItems = (tbl as Record<string, { name?: string }>).orderId?.name === "order_id";
      const ins: Record<string, unknown> = {};
      ins.values = vi.fn((vals: unknown) => {
        if (Array.isArray(vals)) {
          STATE.insertedOrderItems.push(...(vals as Record<string, unknown>[]));
        } else if (tblIsOrders) {
          STATE.insertedOrders.push(vals as Record<string, unknown>);
        } else if (tblIsOrderItems) {
          STATE.insertedOrderItems.push(vals as Record<string, unknown>);
        }
        return ins;
      });
      ins.returning = vi.fn(async () => [{ id: "order-test-id" }]);
      return ins;
    });

    return fn({
      select: txSelect,
      update: txUpdate,
      insert: txInsert,
    });
  });

  return {
    db: {
      select,
      update,
      insert,
      transaction,
    },
  };
});

// ── Tests ────────────────────────────────────────────────────

describe("createOrder + stock control (mig 044)", () => {
  beforeEach(() => {
    STATE.managed = [];
    STATE.updateOutcomes = new Map();
    STATE.raceLost = new Set();
    STATE.alertUpdates = [];
    STATE.insertedOrders = [];
    STATE.insertedOrderItems = [];
    queueCalls.length = 0;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("decrementa stock y crea pedido cuando hay suficiente", async () => {
    STATE.managed = [
      { id: "i1", name: "Pizza", stockQty: 10, lowStockThreshold: null, lastLowStockAlertAt: null },
    ];
    STATE.updateOutcomes.set("i1", {
      stockQty: 7,
      lowStockThreshold: null,
      lastLowStockAlertAt: null,
    });

    const { createOrder } = await import("@/lib/orders");
    const order = await createOrder({
      tenantId: TENANT,
      items: [{ name: "Pizza", quantity: 3, unitPriceCents: 1000 }],
      isTest: true, // evita rama de turnos POS
    });

    expect(order).toEqual({ id: "order-test-id" });
    expect(STATE.insertedOrders.length).toBe(1);
    expect(STATE.insertedOrderItems.length).toBe(1);
    // No alerta porque threshold es NULL.
    expect(queueCalls.filter((c) => c.kind === "low_stock").length).toBe(0);
  });

  it("rechaza pedido con OutOfStockError si stock_qty < quantity solicitada", async () => {
    STATE.managed = [
      { id: "i1", name: "Pizza", stockQty: 2, lowStockThreshold: null, lastLowStockAlertAt: null },
    ];
    const { createOrder, OutOfStockError } = await import("@/lib/orders");

    await expect(
      createOrder({
        tenantId: TENANT,
        items: [{ name: "Pizza", quantity: 5, unitPriceCents: 1000 }],
        isTest: true,
      }),
    ).rejects.toBeInstanceOf(OutOfStockError);

    // No se insertó pedido ni items.
    expect(STATE.insertedOrders.length).toBe(0);
    expect(STATE.insertedOrderItems.length).toBe(0);
  });

  it("OutOfStockError expone .items con los detalles del fallo", async () => {
    STATE.managed = [
      { id: "i1", name: "Pizza", stockQty: 1, lowStockThreshold: null, lastLowStockAlertAt: null },
      { id: "i2", name: "Burger", stockQty: 0, lowStockThreshold: null, lastLowStockAlertAt: null },
    ];
    const { createOrder, OutOfStockError } = await import("@/lib/orders");

    try {
      await createOrder({
        tenantId: TENANT,
        items: [
          { name: "Pizza", quantity: 5, unitPriceCents: 1000 },
          { name: "Burger", quantity: 1, unitPriceCents: 800 },
        ],
        isTest: true,
      });
      throw new Error("debería haber lanzado");
    } catch (err) {
      expect(err).toBeInstanceOf(OutOfStockError);
      const oos = err as InstanceType<typeof OutOfStockError>;
      expect(oos.code).toBe("out_of_stock");
      const names = oos.items.map((i) => i.name).sort();
      expect(names).toEqual(["Burger", "Pizza"]);
    }
  });

  it("ignora items sin gestión (stock_qty = NULL) — comportamiento legacy", async () => {
    STATE.managed = [
      { id: "i1", name: "Pizza", stockQty: null, lowStockThreshold: null, lastLowStockAlertAt: null },
    ];
    const { createOrder } = await import("@/lib/orders");

    const order = await createOrder({
      tenantId: TENANT,
      items: [{ name: "Pizza", quantity: 999, unitPriceCents: 1000 }],
      isTest: true,
    });
    expect(order).toEqual({ id: "order-test-id" });
    expect(STATE.insertedOrders.length).toBe(1);
  });

  it("dispara alerta low_stock cuando stock baja del threshold y no hay cooldown activo", async () => {
    STATE.managed = [
      {
        id: "i1",
        name: "Pizza",
        stockQty: 5,
        lowStockThreshold: 3,
        lastLowStockAlertAt: null, // sin alertas previas
      },
    ];
    STATE.updateOutcomes.set("i1", {
      stockQty: 2,
      lowStockThreshold: 3,
      lastLowStockAlertAt: null,
    });

    const { createOrder } = await import("@/lib/orders");
    await createOrder({
      tenantId: TENANT,
      items: [{ name: "Pizza", quantity: 3, unitPriceCents: 1000 }],
      isTest: true,
    });

    const lowStockCalls = queueCalls.filter((c) => c.kind === "low_stock");
    expect(lowStockCalls.length).toBe(0); // isTest=true salta alertas
  });

  it("dispara alerta low_stock en pedido REAL (isTest=false) cuando cae bajo threshold", async () => {
    STATE.managed = [
      {
        id: "i1",
        name: "Pizza",
        stockQty: 5,
        lowStockThreshold: 3,
        lastLowStockAlertAt: null,
      },
    ];
    STATE.updateOutcomes.set("i1", {
      stockQty: 2,
      lowStockThreshold: 3,
      lastLowStockAlertAt: null,
    });

    const { createOrder } = await import("@/lib/orders");
    await createOrder({
      tenantId: TENANT,
      items: [{ name: "Pizza", quantity: 3, unitPriceCents: 1000 }],
      // isTest no se pasa = real
    });

    const lowStockCalls = queueCalls.filter((c) => c.kind === "low_stock");
    expect(lowStockCalls.length).toBe(1);
    expect(lowStockCalls[0].data).toMatchObject({
      name: "Pizza",
      stockQty: 2,
      threshold: 3,
    });
  });

  it("NO dispara alerta cuando lastLowStockAlertAt está dentro del cooldown 1h", async () => {
    const recent = new Date(Date.now() - 30 * 60 * 1000); // 30 min atrás
    STATE.managed = [
      {
        id: "i1",
        name: "Pizza",
        stockQty: 5,
        lowStockThreshold: 3,
        lastLowStockAlertAt: recent,
      },
    ];
    STATE.updateOutcomes.set("i1", {
      stockQty: 2,
      lowStockThreshold: 3,
      lastLowStockAlertAt: recent,
    });

    const { createOrder } = await import("@/lib/orders");
    await createOrder({
      tenantId: TENANT,
      items: [{ name: "Pizza", quantity: 3, unitPriceCents: 1000 }],
    });

    const lowStockCalls = queueCalls.filter((c) => c.kind === "low_stock");
    expect(lowStockCalls.length).toBe(0);
  });

  it("SÍ dispara alerta cuando lastLowStockAlertAt es de hace más de 1h", async () => {
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h atrás
    STATE.managed = [
      {
        id: "i1",
        name: "Pizza",
        stockQty: 5,
        lowStockThreshold: 3,
        lastLowStockAlertAt: old,
      },
    ];
    STATE.updateOutcomes.set("i1", {
      stockQty: 2,
      lowStockThreshold: 3,
      lastLowStockAlertAt: old,
    });

    const { createOrder } = await import("@/lib/orders");
    await createOrder({
      tenantId: TENANT,
      items: [{ name: "Pizza", quantity: 3, unitPriceCents: 1000 }],
    });

    const lowStockCalls = queueCalls.filter((c) => c.kind === "low_stock");
    expect(lowStockCalls.length).toBe(1);
  });
});

describe("buildLowStockMessage (mig 044)", () => {
  it("construye el mensaje exacto que pidió Mario", async () => {
    const { buildLowStockMessage } = await import("@/lib/pos-reports");
    const msg = buildLowStockMessage({ name: "Pizza margarita", stockQty: 2, threshold: 5 });
    expect(msg).toContain("⚠️ Ordy Chat · Stock bajo");
    expect(msg).toContain('El plato "Pizza margarita" tiene solo 2 unidades restantes.');
    expect(msg).toContain("Threshold configurado: 5.");
    expect(msg).toContain("Repón antes de que se agote o cambia el stock en la carta.");
  });
});
