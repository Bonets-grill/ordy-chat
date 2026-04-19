// web/tests/unit/cron/closed-days-cleanup.test.ts
// Verifica el cron que purga fechas pasadas de agent_configs.reservations_closed_for.
// Mocks @/lib/db + @/lib/cron para aislar el handler.

import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted mocks — deben ir antes de los imports del handler.
vi.mock("@/lib/db", () => {
  const execute = vi.fn();
  const insertValues = vi.fn().mockResolvedValue(undefined);
  const insert = vi.fn(() => ({ values: insertValues }));
  return { db: { execute, insert } };
});

vi.mock("@/lib/cron", () => ({
  validateCronAuth: vi.fn((_req: Request) => null),
}));

import { db } from "@/lib/db";
import { validateCronAuth } from "@/lib/cron";
import { GET } from "@/app/api/cron/closed-days-cleanup/route";

const mockDb = db as unknown as {
  execute: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
};
const mockValidate = validateCronAuth as unknown as ReturnType<typeof vi.fn>;

function fakeReq(): Request {
  return new Request("http://localhost/api/cron/closed-days-cleanup", {
    headers: { authorization: "Bearer test" },
  });
}

beforeEach(() => {
  mockDb.execute.mockReset();
  mockDb.insert.mockClear();
  mockValidate.mockReset();
  mockValidate.mockReturnValue(null);
});

describe("cron closed-days-cleanup", () => {
  it("rechaza 401 cuando validateCronAuth devuelve una respuesta", async () => {
    const unauth = new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    mockValidate.mockReturnValueOnce(unauth);
    const res = await GET(fakeReq() as never);
    expect(res).toBe(unauth);
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it("sin filas modificadas no escribe audit_log y responde 0/0", async () => {
    mockDb.execute.mockResolvedValueOnce([] as never);
    const res = await GET(fakeReq() as never);
    const body = await res.json();
    expect(body).toEqual({ ok: true, tenantCount: 0, totalPurged: 0 });
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("suma purged_count de cada fila y escribe audit_log", async () => {
    mockDb.execute.mockResolvedValueOnce([
      { tenantId: "t1", purged: 3 },
      { tenantId: "t2", purged: 1 },
      { tenantId: "t3", purged: 0 },
    ] as never);
    const res = await GET(fakeReq() as never);
    const body = await res.json();
    expect(body).toEqual({ ok: true, tenantCount: 3, totalPurged: 4 });
    expect(mockDb.insert).toHaveBeenCalledTimes(1);
  });

  it("tolera purged undefined tratándolo como 0", async () => {
    mockDb.execute.mockResolvedValueOnce([
      { tenantId: "t1" },
      { tenantId: "t2", purged: 2 },
    ] as never);
    const res = await GET(fakeReq() as never);
    const body = await res.json();
    expect(body.totalPurged).toBe(2);
    expect(body.tenantCount).toBe(2);
  });
});
