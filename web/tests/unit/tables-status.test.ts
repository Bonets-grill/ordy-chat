// web/tests/unit/tables-status.test.ts
//
// Tests del GET /api/tenant/tables/layout (mig 043).
// La ruta hace LEFT JOIN restaurant_tables × table_sessions filtrada por
// closed_at IS NULL — verificamos que el mapeo de status sea correcto:
//   sin sesión → free
//   pending|active → active
//   billing → billing
//   paid → paid
//   closed → free (no debería aparecer porque closed_at IS NOT NULL, pero
//                  defensivamente cae a free)

import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_A = "00000000-0000-0000-0000-00000000000a";

type JoinedRow = {
  id: string;
  number: string;
  posX: number;
  posY: number;
  shape: string;
  seats: number;
  rotation: number;
  area: string | null;
  zone: string | null;
  width: number;
  height: number;
  active: boolean;
  sessionId: string | null;
  sessionStatus: string | null;
  sessionTotalCents: number | null;
};

const ROWS: JoinedRow[] = [];

vi.mock("@/lib/db", () => {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn(async () => ROWS),
  };
  return {
    db: {
      select: vi.fn(() => selectChain),
    },
  };
});

vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("drizzle-orm");
  return {
    ...actual,
    eq: () => ({}),
    and: () => ({}),
    isNull: () => ({}),
    asc: () => ({}),
    sql: (..._args: unknown[]) => ({ _sql: true }),
  };
});

vi.mock("@/lib/db/schema", () => ({
  restaurantTables: {
    id: {},
    tenantId: {},
    number: {},
    posX: {},
    posY: {},
    shape: {},
    seats: {},
    rotation: {},
    area: {},
    zone: {},
    width: {},
    height: {},
    active: {},
    sortOrder: {},
  },
  tableSessions: {
    id: {},
    tenantId: {},
    tableNumber: {},
    status: {},
    totalCents: {},
    closedAt: {},
    isTest: {},
  },
}));

vi.mock("@/lib/tenant", () => ({
  requireTenant: vi.fn(async () => ({
    tenant: { id: TENANT_A },
    config: null,
    trialDaysLeft: 7,
  })),
}));

async function callGet() {
  const mod = await import("@/app/api/tenant/tables/layout/route");
  const res = await mod.GET();
  const json = (await res.json()) as { tables: Array<Record<string, unknown>> };
  return { status: res.status, json };
}

function mkRow(partial: Partial<JoinedRow> & { id: string; number: string }): JoinedRow {
  return {
    posX: 0,
    posY: 0,
    shape: "square",
    seats: 4,
    rotation: 0,
    area: null,
    zone: null,
    width: 80,
    height: 80,
    active: true,
    sessionId: null,
    sessionStatus: null,
    sessionTotalCents: null,
    ...partial,
  };
}

describe("GET /api/tenant/tables/layout — mig 043 status mapping", () => {
  beforeEach(() => {
    ROWS.length = 0;
  });

  it("mesa sin sesión → status='free'", async () => {
    ROWS.push(mkRow({ id: "t1", number: "1" }));
    const { status, json } = await callGet();
    expect(status).toBe(200);
    expect(json.tables[0].status).toBe("free");
    expect(json.tables[0].sessionId).toBeUndefined();
  });

  it("sesión status='pending' → 'active' (mesa abierta sin pedidos aceptados)", async () => {
    ROWS.push(mkRow({ id: "t1", number: "1", sessionId: "s1", sessionStatus: "pending", sessionTotalCents: 0 }));
    const { json } = await callGet();
    expect(json.tables[0].status).toBe("active");
    expect(json.tables[0].sessionId).toBe("s1");
  });

  it("sesión status='active' → 'active' con totalCents", async () => {
    ROWS.push(mkRow({ id: "t1", number: "1", sessionId: "s2", sessionStatus: "active", sessionTotalCents: 4250 }));
    const { json } = await callGet();
    expect(json.tables[0].status).toBe("active");
    expect(json.tables[0].totalCents).toBe(4250);
  });

  it("sesión status='billing' → 'billing'", async () => {
    ROWS.push(mkRow({ id: "t1", number: "1", sessionId: "s3", sessionStatus: "billing", sessionTotalCents: 1234 }));
    const { json } = await callGet();
    expect(json.tables[0].status).toBe("billing");
  });

  it("sesión status='paid' → 'paid'", async () => {
    ROWS.push(mkRow({ id: "t1", number: "1", sessionId: "s4", sessionStatus: "paid", sessionTotalCents: 999 }));
    const { json } = await callGet();
    expect(json.tables[0].status).toBe("paid");
  });

  it("sesión status='closed' → 'free' (defensivo)", async () => {
    ROWS.push(mkRow({ id: "t1", number: "1", sessionId: "s5", sessionStatus: "closed", sessionTotalCents: 0 }));
    const { json } = await callGet();
    expect(json.tables[0].status).toBe("free");
  });

  it("propaga campos del plano (posX/posY/shape/seats/rotation/area/width/height)", async () => {
    ROWS.push(
      mkRow({
        id: "t1",
        number: "1",
        posX: 350,
        posY: 420,
        shape: "round",
        seats: 6,
        rotation: 90,
        area: "Terraza",
        width: 120,
        height: 120,
      }),
    );
    const { json } = await callGet();
    const t = json.tables[0];
    expect(t.posX).toBe(350);
    expect(t.posY).toBe(420);
    expect(t.shape).toBe("round");
    expect(t.seats).toBe(6);
    expect(t.rotation).toBe(90);
    expect(t.area).toBe("Terraza");
    expect(t.width).toBe(120);
    expect(t.height).toBe(120);
    expect(t.tableNumber).toBe("1");
  });

  it("usa zone como fallback cuando area es null (retrocompat mig 035)", async () => {
    ROWS.push(mkRow({ id: "t1", number: "1", area: null, zone: "Interior" }));
    const { json } = await callGet();
    expect(json.tables[0].area).toBe("Interior");
  });

  it("area gana sobre zone si ambos presentes", async () => {
    ROWS.push(mkRow({ id: "t1", number: "1", area: "Salón", zone: "Interior" }));
    const { json } = await callGet();
    expect(json.tables[0].area).toBe("Salón");
  });
});
