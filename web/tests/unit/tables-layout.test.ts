// web/tests/unit/tables-layout.test.ts
//
// Tests del PATCH /api/tenant/tables/[id]/position (mig 043).
// Cubrimos:
//   - 400 si pos fuera de bounds (0..2000) o rotation no es múltiplo de 90
//   - 401 sin tenant
//   - 404 si la mesa pertenece a otro tenant (multi-tenant ownership)
//   - 200 con coordenadas válidas
//
// Mockeamos @/lib/db y @/lib/tenant para no tocar Postgres ni auth real.

import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_A = "00000000-0000-0000-0000-00000000000a";
const TENANT_B = "00000000-0000-0000-0000-00000000000b";
const TABLE_OF_A = "11111111-1111-4111-8111-111111111111";
const TABLE_OF_B = "22222222-2222-4222-8222-222222222222";

type Row = { id: string; tenantId: string; posX: number; posY: number; rotation: number };
const TABLES_DB = new Map<string, Row>();

vi.mock("@/lib/db", () => {
  // Capturamos el filtro por hooks colocados en eq/and (ver mock drizzle-orm).
  let currentFilter: { id?: string; tenantId?: string } = {};

  const updateChain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn(function (this: typeof updateChain, cond: { _id?: string; _tenantId?: string } | undefined) {
      if (cond && typeof cond === "object") {
        if ("_id" in cond) currentFilter.id = cond._id as string;
        if ("_tenantId" in cond) currentFilter.tenantId = cond._tenantId as string;
      }
      return this;
    }),
    returning: vi.fn(async () => {
      const { id, tenantId } = currentFilter;
      currentFilter = {};
      if (!id) return [];
      const found = TABLES_DB.get(id);
      if (!found) return [];
      if (tenantId && found.tenantId !== tenantId) return [];
      // Aplica el set guardado (último .set call) — para esta suite basta con
      // devolver la fila como si se hubiera actualizado.
      return [{ id: found.id, posX: found.posX, posY: found.posY, rotation: found.rotation }];
    }),
  };

  return {
    db: {
      update: vi.fn(() => updateChain),
    },
  };
});

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
    and: (...args: Array<{ _id?: string; _tenantId?: string }>) =>
      args.reduce<{ _id?: string; _tenantId?: string }>((acc, a) => ({ ...acc, ...a }), {}),
  };
});

vi.mock("@/lib/db/schema", () => ({
  restaurantTables: {
    id: { name: "id" },
    tenantId: { name: "tenant_id" },
    posX: { name: "pos_x" },
    posY: { name: "pos_y" },
    rotation: { name: "rotation" },
  },
}));

const authState: { tenantId: string | null } = { tenantId: TENANT_A };
vi.mock("@/lib/tenant", () => ({
  requireTenant: vi.fn(async () => {
    if (!authState.tenantId) return null;
    return {
      tenant: { id: authState.tenantId },
      config: null,
      trialDaysLeft: 7,
    };
  }),
}));

async function callPatch(tableId: string, body: unknown) {
  const mod = await import("@/app/api/tenant/tables/[id]/position/route");
  const req = new Request(`http://test.local/api/tenant/tables/${tableId}/position`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await mod.PATCH(req, { params: Promise.resolve({ id: tableId }) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe("PATCH /api/tenant/tables/[id]/position — mig 043 plano", () => {
  beforeEach(() => {
    TABLES_DB.clear();
    TABLES_DB.set(TABLE_OF_A, { id: TABLE_OF_A, tenantId: TENANT_A, posX: 100, posY: 100, rotation: 0 });
    TABLES_DB.set(TABLE_OF_B, { id: TABLE_OF_B, tenantId: TENANT_B, posX: 200, posY: 200, rotation: 0 });
    authState.tenantId = TENANT_A;
  });

  it("rechaza posX negativo con 400", async () => {
    const r = await callPatch(TABLE_OF_A, { posX: -1, posY: 50 });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe("bad_input");
  });

  it("rechaza posX > 2000 con 400", async () => {
    const r = await callPatch(TABLE_OF_A, { posX: 2001, posY: 50 });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe("bad_input");
  });

  it("rechaza posY > 2000 con 400", async () => {
    const r = await callPatch(TABLE_OF_A, { posX: 50, posY: 9999 });
    expect(r.status).toBe(400);
  });

  it("rechaza rotation no múltiplo de 90 con 400", async () => {
    const r = await callPatch(TABLE_OF_A, { posX: 100, posY: 100, rotation: 45 });
    expect(r.status).toBe(400);
  });

  it("rechaza body sin posX/posY", async () => {
    const r = await callPatch(TABLE_OF_A, { rotation: 90 });
    expect(r.status).toBe(400);
  });

  it("devuelve 401 sin tenant autenticado", async () => {
    authState.tenantId = null;
    const r = await callPatch(TABLE_OF_A, { posX: 100, posY: 100 });
    expect(r.status).toBe(401);
  });

  it("devuelve 404 si la mesa pertenece a otro tenant (multi-tenant)", async () => {
    authState.tenantId = TENANT_A;
    const r = await callPatch(TABLE_OF_B, { posX: 300, posY: 300 });
    expect(r.status).toBe(404);
    expect(r.json.error).toBe("not_found");
  });

  it("acepta coordenadas válidas con 200", async () => {
    const r = await callPatch(TABLE_OF_A, { posX: 500, posY: 700 });
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
  });

  it("acepta rotation 0/90/180/270", async () => {
    for (const rot of [0, 90, 180, 270]) {
      const r = await callPatch(TABLE_OF_A, { posX: 100, posY: 100, rotation: rot });
      expect(r.status).toBe(200);
    }
  });
});
