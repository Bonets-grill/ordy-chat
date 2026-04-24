// web/tests/unit/daily-cron.test.ts
// Mig 040: test del cron /api/cron/daily-sales-report.
//
// Mock DB + sendPosReport + validateCronAuth. Verifica:
//   - procesa tenants con actividad (2 tenants en el mock)
//   - cierra turnos abiertos (UPDATE ejecutado con los tenant_ids correctos)
//   - llama sendPosReport 1 vez por tenant
//   - devuelve { tenantsProcessed: N, errors: [] }

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Estado compartido mutable para controlar las respuestas del db.execute mock
// en cada test sin re-hoistear.
type ExecuteResult = unknown[];
const executeResponses: ExecuteResult[] = [];
let executeCallLog: Array<{ sqlStr: string }> = [];

function nextExecuteResponse(): ExecuteResult {
  return executeResponses.shift() ?? [];
}

vi.mock("@/lib/db", () => ({
  db: {
    execute: vi.fn(async (q: unknown) => {
      // Drizzle SQL object: tiene .queryChunks / .strings. Para el log
      // extraemos un resumen textual para asserts simples.
      const asStr = String((q as { sql?: string; strings?: string[] })?.sql ?? JSON.stringify(q).slice(0, 200));
      executeCallLog.push({ sqlStr: asStr });
      return nextExecuteResponse();
    }),
  },
}));

vi.mock("@/lib/crypto", () => ({
  cifrar: (s: string) => s,
  descifrar: (s: string) => s,
}));

const sendPosReportMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/pos-reports", () => ({
  sendPosReport: (tenantId: string, kind: string, data: unknown) => sendPosReportMock(tenantId, kind, data),
}));

vi.mock("@/lib/cron", () => ({
  validateCronAuth: () => null, // siempre autorizado en tests
}));

describe("cron daily-sales-report", () => {
  beforeEach(() => {
    executeResponses.length = 0;
    executeCallLog = [];
    sendPosReportMock.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("procesa tenants con actividad, cierra turnos abiertos, llama sendPosReport 1 vez por tenant", async () => {
    // 1º execute: SELECT tenants con actividad
    executeResponses.push([
      {
        tenantId: "11111111-1111-1111-1111-111111111111",
        orderCount: 18,
        totalCents: 65_000,
        reportDate: "23/04/2026",
      },
      {
        tenantId: "22222222-2222-2222-2222-222222222222",
        orderCount: 9,
        totalCents: 32_000,
        reportDate: "23/04/2026",
      },
    ]);
    // 2º execute: UPDATE shifts (cierre masivo). Devolvemos [] — no usamos el resultado.
    executeResponses.push([]);
    // Para cada tenant (2): 3 execute calls — shifts, topItems, breakdown.
    // Tenant 1:
    executeResponses.push([
      {
        tenantId: "11111111-1111-1111-1111-111111111111",
        openedAt: "2026-04-23T07:00:00Z",
        closedAt: "2026-04-23T12:30:00Z",
        orderCount: 18,
        totalCents: 65_000,
      },
    ]);
    executeResponses.push([
      { tenantId: "11111111-1111-1111-1111-111111111111", name: "Hamburguesa", quantity: 18 },
      { tenantId: "11111111-1111-1111-1111-111111111111", name: "Patatas", quantity: 10 },
    ]);
    executeResponses.push([{ cashCents: 45_000, cardCents: 20_000 }]);
    // Tenant 2:
    executeResponses.push([
      {
        tenantId: "22222222-2222-2222-2222-222222222222",
        openedAt: "2026-04-23T18:00:00Z",
        closedAt: null,
        orderCount: 9,
        totalCents: 32_000,
      },
    ]);
    executeResponses.push([
      { tenantId: "22222222-2222-2222-2222-222222222222", name: "Pizza", quantity: 9 },
    ]);
    executeResponses.push([{ cashCents: 20_000, cardCents: 12_000 }]);

    // Import del route handler DESPUÉS de los mocks.
    const { GET } = await import("@/app/api/cron/daily-sales-report/route");

    const req = new Request("http://localhost/api/cron/daily-sales-report", {
      headers: { authorization: "Bearer test-secret" },
    });
    const res = await GET(req as unknown as Parameters<typeof GET>[0]);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.tenantsProcessed).toBe(2);
    expect(body.errors).toEqual([]);

    // 1 SELECT tenants + 1 UPDATE cierre + (3 x 2 tenants) agregaciones = 8
    expect(executeCallLog.length).toBe(8);

    // sendPosReport 1 vez por tenant.
    expect(sendPosReportMock).toHaveBeenCalledTimes(2);
    const [firstArgs, secondArgs] = sendPosReportMock.mock.calls;
    expect(firstArgs[0]).toBe("11111111-1111-1111-1111-111111111111");
    expect(firstArgs[1]).toBe("daily_summary");
    expect(firstArgs[2].orderCount).toBe(18);
    expect(firstArgs[2].totalCents).toBe(65_000);
    expect(firstArgs[2].cashCents).toBe(45_000);
    expect(firstArgs[2].cardCents).toBe(20_000);
    expect(firstArgs[2].shiftLines.length).toBe(1);
    expect(firstArgs[2].topItems).toEqual([
      { name: "Hamburguesa", quantity: 18 },
      { name: "Patatas", quantity: 10 },
    ]);

    expect(secondArgs[0]).toBe("22222222-2222-2222-2222-222222222222");
    expect(secondArgs[2].shiftLines[0]).toContain("abierto"); // turno sin cerrar → etiqueta 'abierto'
  });

  it("sin tenants activos devuelve tenantsProcessed=0 y no toca shifts", async () => {
    executeResponses.push([]); // SELECT tenants — vacío
    // No debería ejecutar el UPDATE masivo (tenantsActive.length===0).

    const { GET } = await import("@/app/api/cron/daily-sales-report/route");
    const req = new Request("http://localhost/api/cron/daily-sales-report", {
      headers: { authorization: "Bearer test-secret" },
    });
    const res = await GET(req as unknown as Parameters<typeof GET>[0]);
    const body = await res.json();

    expect(body.tenantsProcessed).toBe(0);
    expect(body.errors).toEqual([]);
    expect(executeCallLog.length).toBe(1); // solo el SELECT inicial
    expect(sendPosReportMock).not.toHaveBeenCalled();
  });
});
