// web/tests/unit/orders-patch.test.ts — tests del handler PATCH /api/orders/[id]
//
// Mig 039: el endpoint unifica "marcar pagado" + "cambiar método" desde KDS
// y dashboard. Cubrimos los casos críticos de Mario:
//   - 400 si el método es inválido (no está en la whitelist de 4)
//   - 404 si el pedido es de OTRO tenant (ownership)
//   - 200 con markPaid=true + default 'cash' cuando no se pasa método
//
// Mockeamos @/lib/db y @/lib/kiosk-auth para no tocar Postgres real.

import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Fixtures ---
const TENANT_A = "00000000-0000-0000-0000-00000000000a";
const TENANT_B = "00000000-0000-0000-0000-00000000000b";
const ORDER_OF_A = "11111111-1111-4111-8111-111111111111";
const ORDER_OF_B = "22222222-2222-4222-8222-222222222222";
const BAD_UUID = "not-a-uuid";

// Registry de pedidos por id — el mock de db.select() filtra con él.
const ORDERS_DB = new Map<string, { id: string; tenantId: string; status: string; paymentMethod: string | null; paidAt: Date | null }>();

// --- Mocks ---
vi.mock("@/lib/db", () => {
  // selectChain simula un SELECT ... FROM orders WHERE id=? AND tenant_id=?
  // Guarda el último "filter target" en closures accedidas por `where`.
  let currentFilter: { id?: string; tenantId?: string } = {};
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn(function (this: typeof selectChain, cond: { _id?: string; _tenantId?: string } | undefined) {
      // Drizzle and() viene como objeto opaco — capturamos via hook: los tests
      // invocan helpers que pinchan currentFilter antes. Fallback: no filtrar.
      if (cond && typeof cond === "object") {
        if ("_id" in cond) currentFilter.id = cond._id as string;
        if ("_tenantId" in cond) currentFilter.tenantId = cond._tenantId as string;
      }
      return this;
    }),
    limit: vi.fn(async () => {
      const { id, tenantId } = currentFilter;
      currentFilter = {}; // reset para siguiente query
      if (!id) return [];
      const found = ORDERS_DB.get(id);
      if (!found) return [];
      if (tenantId && found.tenantId !== tenantId) return [];
      return [found];
    }),
  };

  const updateChain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn(async () => {
      // El handler hace .where(and(eq(orders.id), eq(orders.tenantId)))
      // — devolvemos el pedido actualizado stub.
      return [{ id: "stub", paymentMethod: "card", status: "paid" }];
    }),
  };

  return {
    db: {
      select: vi.fn(() => selectChain),
      update: vi.fn(() => updateChain),
    },
    __testing: {
      setFilter: (f: { id?: string; tenantId?: string }) => {
        currentFilter = f;
      },
    },
  };
});

// eq() de drizzle se invoca con (column, value). Devolvemos el "value" como
// marker que el where mock captura. Hack, pero suficiente para esta suite.
vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("drizzle-orm");
  return {
    ...actual,
    eq: (col: { name?: string } | string, val: string) => {
      const colName = typeof col === "string" ? col : col?.name ?? "";
      if (colName === "id") return { _id: val };
      if (colName === "tenant_id") return { _tenantId: val };
      return { col, val };
    },
    and: (...args: Array<{ _id?: string; _tenantId?: string }>) => {
      return args.reduce<{ _id?: string; _tenantId?: string }>((acc, a) => ({ ...acc, ...a }), {});
    },
  };
});

// Drizzle schema: el mock de eq() lee .name — las "columnas" son objetos con .name.
vi.mock("@/lib/db/schema", () => ({
  orders: {
    id: { name: "id" },
    tenantId: { name: "tenant_id" },
    paymentMethod: { name: "payment_method" },
  },
}));

// Auth: por defecto el tenant autenticado es TENANT_A. Los tests cambian el
// tenant activo cuando hace falta probar ownership cross-tenant.
const authState: { tenantId: string } = { tenantId: TENANT_A };
vi.mock("@/lib/kiosk-auth", () => ({
  requireTenantOrKiosk: vi.fn(async () => ({
    tenant: { id: authState.tenantId },
  })),
}));

// markOrderPaidManual: stub que delega al ORDERS_DB para comportarse como el real.
vi.mock("@/lib/orders", () => ({
  markOrderPaidManual: vi.fn(async (orderId: string, tenantId: string, method: string) => {
    const found = ORDERS_DB.get(orderId);
    if (!found || found.tenantId !== tenantId) return null;
    found.status = "paid";
    found.paidAt = new Date();
    found.paymentMethod = method;
    return { ...found };
  }),
}));

// --- Helpers ---
async function callPatch(orderId: string, body: unknown) {
  const mod = await import("@/app/api/orders/[id]/route");
  const req = new Request(`http://test.local/api/orders/${orderId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await mod.PATCH(req, { params: Promise.resolve({ id: orderId }) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

// --- Suite ---
describe("PATCH /api/orders/[id] — mig 039 payment method", () => {
  beforeEach(() => {
    ORDERS_DB.clear();
    ORDERS_DB.set(ORDER_OF_A, {
      id: ORDER_OF_A,
      tenantId: TENANT_A,
      status: "ready",
      paymentMethod: null,
      paidAt: null,
    });
    ORDERS_DB.set(ORDER_OF_B, {
      id: ORDER_OF_B,
      tenantId: TENANT_B,
      status: "ready",
      paymentMethod: null,
      paidAt: null,
    });
    authState.tenantId = TENANT_A;
  });

  it("rechaza método de pago inválido con 400", async () => {
    const r = await callPatch(ORDER_OF_A, { paymentMethod: "bitcoin" });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe("bad_input");
  });

  it("rechaza UUID mal formado con 400", async () => {
    const r = await callPatch(BAD_UUID, { markPaid: true, paymentMethod: "cash" });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe("bad_order_id");
  });

  it("rechaza body vacío con 400 (zod refine)", async () => {
    const r = await callPatch(ORDER_OF_A, {});
    expect(r.status).toBe(400);
    expect(r.json.error).toBe("bad_input");
  });

  it("devuelve 404 si el pedido pertenece a otro tenant (ownership)", async () => {
    // Auth como tenant A, pero pedimos actualizar pedido de tenant B.
    authState.tenantId = TENANT_A;
    const r = await callPatch(ORDER_OF_B, { markPaid: true, paymentMethod: "card" });
    expect(r.status).toBe(404);
    expect(r.json.error).toBe("order_not_found");
  });

  it("acepta markPaid=true sin paymentMethod y usa default 'cash'", async () => {
    const r = await callPatch(ORDER_OF_A, { markPaid: true });
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
    const { markOrderPaidManual } = await import("@/lib/orders");
    // Última invocación: (orderId, tenantId, 'cash').
    const calls = (markOrderPaidManual as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const lastCall = calls[calls.length - 1] as unknown[];
    expect(lastCall?.[2]).toBe("cash");
  });

  it("acepta los 4 métodos canónicos", async () => {
    for (const m of ["cash", "card", "transfer", "other"] as const) {
      const r = await callPatch(ORDER_OF_A, { markPaid: true, paymentMethod: m });
      expect(r.status).toBe(200);
    }
  });
});
