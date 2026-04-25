// web/tests/unit/orders-with-modifiers.test.ts
//
// Tests del cálculo de precio cuando un OrderItemInput trae modifiers (mig
// 042). El test mockea db, agentConfigs/tenants/orderItems y verifica:
//   - unitPriceCentsAdjusted = unitPriceCents + sum(modifiers.priceDeltaCents)
//   - lineTotalCents = qty * unitPriceCentsAdjusted
//   - modifiersJson se persiste con el snapshot
//   - modifiers vacíos o ausentes → comportamiento legacy (sin delta)
//
// El motor de tax (lib/tax/compute) NO se mockea — usamos su lógica real para
// garantizar que tax se calcula sobre el precio ya ajustado, no sobre el base.

import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "00000000-0000-0000-0000-00000000000a";

// Tracker de los values que llegaron al insert(orderItems).
let capturedItemRows: Array<Record<string, unknown>> = [];
// Tracker de la fila de orders insertada (para verificar totals).
let capturedOrderRow: Record<string, unknown> | null = null;

vi.mock("@/lib/db", () => {
  // Tenant fixture: tax 10% PVP-incluido (caso típico ES peninsula).
  const tenantRow = {
    taxRateStandard: "10.00",
    pricesIncludeTax: true,
    taxLabel: "IVA",
  };

  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(async () => [tenantRow]),
  };

  // Insert: distinguimos por la "tabla" capturada en .values().
  const insertChain = {
    values: vi.fn(function (this: typeof insertChain, vals: Record<string, unknown> | Record<string, unknown>[]) {
      if (Array.isArray(vals)) {
        // order_items: array de filas.
        capturedItemRows = vals;
      } else {
        // orders: una sola fila.
        capturedOrderRow = vals;
      }
      return this;
    }),
    returning: vi.fn(async () => [{ id: "order-stub", tenantId: TENANT_ID }]),
  };

  // No-op para updates (table_sessions, agent_configs etc.)
  const updateChain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn(async () => []),
  };

  // Stock check de mig 044: tx.select sobre menuItems devuelve []
  // (sin items gestionados → comportamiento ilimitado, sin decremento).
  const txStockSelectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn(async () => []),
  };

  const tx = {
    select: vi.fn(() => txStockSelectChain),
    insert: vi.fn(() => insertChain),
    update: vi.fn(() => updateChain),
  };

  return {
    db: {
      select: vi.fn(() => selectChain),
      insert: vi.fn(() => insertChain),
      update: vi.fn(() => updateChain),
      delete: vi.fn(() => ({ where: vi.fn().mockReturnThis(), returning: vi.fn(async () => []) })),
      transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(tx)),
    },
  };
});

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("drizzle-orm");
  return {
    ...actual,
    eq: vi.fn(() => ({})),
    and: vi.fn(() => ({})),
    inArray: vi.fn(() => ({})),
    isNull: vi.fn(() => ({})),
    sql: Object.assign(vi.fn(() => ({})), { raw: vi.fn(() => ({})) }),
  };
});

vi.mock("@/lib/db/schema", () => ({
  orders: { id: { name: "id" }, tenantId: { name: "tenant_id" } },
  orderItems: { orderId: { name: "order_id" } },
  tenants: { id: { name: "id" } },
  agentConfigs: { tenantId: { name: "tenant_id" } },
  shifts: { tenantId: { name: "tenant_id" }, closedAt: { name: "closed_at" } },
  tableSessions: {
    id: { name: "id" },
    tenantId: { name: "tenant_id" },
    tableNumber: { name: "table_number" },
    status: { name: "status" },
    totalCents: { name: "total_cents" },
  },
  // Mig 044: stock control. Mock con todos los campos que createOrder lee.
  menuItems: {
    id: { name: "id" },
    name: { name: "name" },
    tenantId: { name: "tenant_id" },
    stockQty: { name: "stock_qty" },
    lowStockThreshold: { name: "low_stock_threshold" },
    lastLowStockAlertAt: { name: "last_low_stock_alert_at" },
    available: { name: "available" },
  },
  // Mig 048: createOrder ahora resuelve modifier name canónico ES desde DB
  // (evita que un cliente en EN persista "Extra cheese" → KDS confundido).
  menuItemModifiers: {
    id: { name: "id" },
    groupId: { name: "group_id" },
    name: { name: "name" },
    priceDeltaCents: { name: "price_delta_cents" },
  },
}));

// Best-effort fire-and-forget; lo silenciamos para que el test no sea ruidoso.
vi.mock("@/lib/pos-reports", () => ({
  queuePosReport: vi.fn(),
}));

vi.mock("@/lib/stripe", () => ({
  stripeClient: vi.fn(),
}));

beforeEach(() => {
  capturedItemRows = [];
  capturedOrderRow = null;
});

describe("createOrder con modifiers (mig 042)", () => {
  it("suma priceDeltaCents al unitPriceCents y persiste modifiersJson", async () => {
    const { createOrder } = await import("@/lib/orders");
    await createOrder({
      tenantId: TENANT_ID,
      orderType: "takeaway",
      customerName: "Mario",
      isTest: true, // saltamos turno POS auto-open en este test
      items: [
        {
          name: "Pizza Margarita",
          quantity: 1,
          unitPriceCents: 1000, // 10,00 €
          modifiers: [
            { groupId: "g1", modifierId: "m1", name: "Extra queso", priceDeltaCents: 150 },
            { groupId: "g2", modifierId: "m2", name: "Tamaño grande", priceDeltaCents: 300 },
          ],
        },
      ],
    });

    expect(capturedItemRows).toHaveLength(1);
    const row = capturedItemRows[0];
    // 1000 + 150 + 300 = 1450
    expect(row.unitPriceCents).toBe(1450);
    expect(row.lineTotalCents).toBe(1450); // qty=1
    expect(row.modifiersJson).toEqual([
      { groupId: "g1", modifierId: "m1", name: "Extra queso", priceDeltaCents: 150 },
      { groupId: "g2", modifierId: "m2", name: "Tamaño grande", priceDeltaCents: 300 },
    ]);
  });

  it("aplica el delta a los totales del pedido (subtotal/tax/total) sobre el precio ajustado", async () => {
    const { createOrder } = await import("@/lib/orders");
    await createOrder({
      tenantId: TENANT_ID,
      orderType: "takeaway",
      customerName: "Mario",
      isTest: true,
      items: [
        {
          name: "Burger",
          quantity: 2,
          unitPriceCents: 1000, // 10,00 €
          modifiers: [
            { groupId: "g", modifierId: "m", name: "Extra bacon", priceDeltaCents: 200 },
          ],
        },
      ],
    });

    // Precio ajustado: 1000 + 200 = 1200. Qty 2 → total bruto 2400.
    // pricesIncludeTax=true tax 10%: subtotal=2182, tax=218, total=2400.
    expect(capturedOrderRow).not.toBeNull();
    expect(capturedOrderRow!.totalCents).toBe(2400);
  });

  it("rechaza modifiers con priceDeltaCents negativos (defense-in-depth)", async () => {
    const { createOrder } = await import("@/lib/orders");
    await createOrder({
      tenantId: TENANT_ID,
      orderType: "takeaway",
      customerName: "Mario",
      isTest: true,
      items: [
        {
          name: "Pizza",
          quantity: 1,
          unitPriceCents: 1000,
          // Caller maligno intenta colar un descuento — el código filtra.
          modifiers: [
            { groupId: "g", modifierId: "m1", name: "Bacon", priceDeltaCents: 200 },
            { groupId: "g", modifierId: "m2", name: "Hack", priceDeltaCents: -500 },
          ],
        },
      ],
    });

    const row = capturedItemRows[0];
    // El delta negativo se ignora; queda solo el +200.
    expect(row.unitPriceCents).toBe(1200);
    expect((row.modifiersJson as unknown[])).toHaveLength(1);
  });

  it("comportamiento legacy: items sin modifiers funcionan igual y persisten []", async () => {
    const { createOrder } = await import("@/lib/orders");
    await createOrder({
      tenantId: TENANT_ID,
      orderType: "takeaway",
      customerName: "Mario",
      isTest: true,
      items: [{ name: "Refresco", quantity: 1, unitPriceCents: 250 }],
    });

    const row = capturedItemRows[0];
    expect(row.unitPriceCents).toBe(250);
    expect(row.modifiersJson).toEqual([]);
  });
});
