// web/tests/unit/admin/queries.test.ts — Tests de queries admin.
//
// Mock de @/lib/db. Las queries son SQL raw con db.execute(), así que
// mockeamos el select-chain y execute() para verificar shape del output,
// no la ejecución real contra Postgres.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    groupBy: vi.fn(),
    limit: vi.fn(),
  };
  return {
    db: {
      select: vi.fn(() => selectChain),
      execute: vi.fn(),
    },
  };
});

import { db } from "@/lib/db";
import {
  getInstanceRows,
  getInstancesKpis,
  getOnboardingJobsKpis,
  type InstanceRow,
} from "@/lib/admin/queries";

const mockDb = db as unknown as {
  select: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  mockDb.select.mockClear();
  mockDb.execute.mockClear();
});

// ─────────────────────────────────────────────────────────

describe("getOnboardingJobsKpis", () => {
  it("cuenta 0 de todo cuando no hay rows", async () => {
    const chain = (mockDb.select as (...args: unknown[]) => {
      from: (...a: unknown[]) => unknown;
      innerJoin: (...a: unknown[]) => unknown;
      where: (...a: unknown[]) => unknown;
      groupBy: (...a: unknown[]) => unknown;
      limit: (...a: unknown[]) => unknown;
    })();
    chain.groupBy = vi.fn().mockResolvedValue([]);

    const kpis = await getOnboardingJobsKpis();
    expect(kpis.by_status.pending).toBe(0);
    expect(kpis.by_status.failed).toBe(0);
    expect(kpis.active_count).toBe(0);
    expect(kpis.failed_24h).toBe(0);
  });

  it("active_count suma pending+scraping+sources_ready+confirming", async () => {
    const chain = (mockDb.select as (...args: unknown[]) => {
      from: (...a: unknown[]) => unknown;
      innerJoin: (...a: unknown[]) => unknown;
      where: (...a: unknown[]) => unknown;
      groupBy: (...a: unknown[]) => unknown;
      limit: (...a: unknown[]) => unknown;
    })();
    chain.groupBy = vi.fn().mockResolvedValue([
      { status: "pending", count: 2 },
      { status: "scraping", count: 1 },
      { status: "sources_ready", count: 1 },
      { status: "confirming", count: 1 },
      { status: "done", count: 10 },
      { status: "failed", count: 3 },
    ]);

    const kpis = await getOnboardingJobsKpis();
    expect(kpis.active_count).toBe(5); // 2+1+1+1
    expect(kpis.failed_24h).toBe(3);
    expect(kpis.by_status.done).toBe(10);
  });

  it("ignora statuses desconocidos (robusto a drift schema)", async () => {
    const chain = (mockDb.select as (...args: unknown[]) => {
      from: (...a: unknown[]) => unknown;
      innerJoin: (...a: unknown[]) => unknown;
      where: (...a: unknown[]) => unknown;
      groupBy: (...a: unknown[]) => unknown;
      limit: (...a: unknown[]) => unknown;
    })();
    chain.groupBy = vi.fn().mockResolvedValue([
      { status: "pending", count: 1 },
      { status: "weird_new_status", count: 99 },
    ]);

    const kpis = await getOnboardingJobsKpis();
    expect(kpis.by_status.pending).toBe(1);
    // El weird no aparece en by_status (solo los 7 del type).
    expect(Object.keys(kpis.by_status)).toHaveLength(7);
  });
});

// ─────────────────────────────────────────────────────────

describe("getInstanceRows", () => {
  const baseRow = {
    tenant_id: "t1",
    tenant_slug: "negocio-demo",
    tenant_name: "Negocio Demo",
    provider: "evolution",
    instance_created_at: "2026-04-15T10:00:00Z",
    age_days: 3,
    tier: "fresh",
    cap: 30,
    msg_hoy: 5,
    burned: false,
    burned_at: null,
    burned_reason: null,
  };

  it("transforma shape raw → InstanceRow[] tipado", async () => {
    mockDb.execute.mockResolvedValue([baseRow]);

    const rows = await getInstanceRows();
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.tenantId).toBe("t1");
    expect(r.tier).toBe("fresh");
    expect(r.cap).toBe(30);
    expect(r.msgHoy).toBe(5);
    expect(r.burned).toBe(false);
    expect(r.instanceCreatedAt).toBeInstanceOf(Date);
  });

  it("soporta shape {rows: [...]} (neon-http alt)", async () => {
    mockDb.execute.mockResolvedValue({ rows: [baseRow] });
    const rows = await getInstanceRows();
    expect(rows).toHaveLength(1);
  });

  it("cap null cuando provider != evolution o tier mature", async () => {
    mockDb.execute.mockResolvedValue([
      { ...baseRow, provider: "meta", tier: "mature", cap: null },
    ]);
    const rows = await getInstanceRows();
    expect(rows[0]!.cap).toBeNull();
    expect(rows[0]!.tier).toBe("mature");
  });

  it("msgHoy = 0 si count_hoy ausente", async () => {
    mockDb.execute.mockResolvedValue([{ ...baseRow, msg_hoy: null }]);
    const rows = await getInstanceRows();
    expect(rows[0]!.msgHoy).toBe(0);
  });

  it("burnedAt convertido a Date; null si no está burned", async () => {
    const burned = {
      ...baseRow,
      burned: true,
      burned_at: "2026-04-17T10:00:00Z",
      burned_reason: "disconnected",
    };
    mockDb.execute.mockResolvedValue([burned, baseRow]);
    const rows = await getInstanceRows();
    expect(rows[0]!.burned).toBe(true);
    expect(rows[0]!.burnedAt).toBeInstanceOf(Date);
    expect(rows[0]!.burnedReason).toBe("disconnected");
    expect(rows[1]!.burnedAt).toBeNull();
  });

  it("resultado vacío cuando execute devuelve []", async () => {
    mockDb.execute.mockResolvedValue([]);
    const rows = await getInstanceRows();
    expect(rows).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────

describe("getInstancesKpis", () => {
  it("devuelve burnedCount y warmupInCurso", async () => {
    // mockDb.select() se llama dos veces (dos count queries).
    // Cada call devuelve un chain que resuelve a [{n: X}].
    let call = 0;
    mockDb.select.mockImplementation(() => {
      call++;
      return {
        from: () => ({
          where: () =>
            Promise.resolve([{ n: call === 1 ? 2 : 7 }]),
        }),
      };
    });

    const kpis = await getInstancesKpis();
    expect(kpis.burnedCount).toBe(2);
    expect(kpis.warmupInCurso).toBe(7);
  });

  it("0/0 cuando no hay rows", async () => {
    mockDb.select.mockImplementation(() => ({
      from: () => ({
        where: () => Promise.resolve([{ n: 0 }]),
      }),
    }));

    const kpis = await getInstancesKpis();
    expect(kpis.burnedCount).toBe(0);
    expect(kpis.warmupInCurso).toBe(0);
  });
});

// Helper: los types exportados están bien.
describe("Types", () => {
  it("InstanceRow types inferibles", () => {
    const r: InstanceRow = {
      tenantId: "t1",
      tenantSlug: "s",
      tenantName: "n",
      provider: "evolution",
      instanceCreatedAt: new Date(),
      ageDays: 0,
      tier: "fresh",
      cap: 30,
      msgHoy: 0,
      burned: false,
      burnedAt: null,
      burnedReason: null,
      warmupOverride: false,
      warmupOverrideReason: null,
      warmupOverrideAt: null,
    };
    expect(r.tier).toBe("fresh");
  });
});
