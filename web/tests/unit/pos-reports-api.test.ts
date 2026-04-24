// web/tests/unit/pos-reports-api.test.ts
// Mig 040: test del endpoint PATCH /api/agent/pos-reports.
//
// Verifica:
//   - 400 con payload inválido (número con letras)
//   - 400 con número muy corto
//   - 200 + normalización (dedupe, quitar '+') cuando payload ok
//   - 401 si no hay sesión
//   - 404 si no hay tenant resuelto

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Captura de updates para asserts.
const updateValues: Array<Record<string, unknown>> = [];

vi.mock("@/lib/db", () => {
  const updateChain = {
    set: vi.fn((values: Record<string, unknown>) => {
      updateValues.push(values);
      return updateChain;
    }),
    where: vi.fn().mockResolvedValue(undefined),
  };
  const insertChain = {
    values: vi.fn().mockResolvedValue(undefined),
  };
  return {
    db: {
      update: vi.fn(() => updateChain),
      insert: vi.fn(() => insertChain),
    },
  };
});

vi.mock("@/lib/crypto", () => ({
  cifrar: (s: string) => s,
  descifrar: (s: string) => s,
}));

const authMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  auth: () => authMock(),
}));

const requireTenantMock = vi.fn();
vi.mock("@/lib/tenant", () => ({
  requireTenant: () => requireTenantMock(),
}));

async function post(body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const { PATCH } = await import("@/app/api/agent/pos-reports/route");
  const req = new Request("http://localhost/api/agent/pos-reports", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await PATCH(req);
  return { status: res.status, json: await res.json() };
}

describe("PATCH /api/agent/pos-reports", () => {
  beforeEach(() => {
    updateValues.length = 0;
    authMock.mockReset();
    requireTenantMock.mockReset();
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    requireTenantMock.mockResolvedValue({
      tenant: { id: "tenant-abc", subscriptionStatus: "active" },
      trialDaysLeft: 0,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("401 si no hay sesión", async () => {
    authMock.mockResolvedValueOnce(null);
    const r = await post({ phones: ["34604342381"] });
    expect(r.status).toBe(401);
  });

  it("404 si no hay tenant", async () => {
    requireTenantMock.mockResolvedValueOnce(null);
    const r = await post({ phones: ["34604342381"] });
    expect(r.status).toBe(404);
  });

  it("400 con número que contiene letras", async () => {
    const r = await post({ phones: ["abc12345678"] });
    expect(r.status).toBe(400);
    expect(r.json.error).toBe("bad_input");
  });

  it("400 con número muy corto", async () => {
    const r = await post({ phones: ["12345"] });
    expect(r.status).toBe(400);
  });

  it("200 + normaliza (quita +, dedupe) con payload válido", async () => {
    const r = await post({
      phones: ["+34604342381", "34604342381", "34604137535"],
    });
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
    expect(r.json.phones).toEqual(["34604342381", "34604137535"]);
    // El update debió recibir la lista normalizada.
    expect(updateValues.at(-1)?.posReportPhones).toEqual(["34604342381", "34604137535"]);
  });

  it("200 con lista vacía (desactivar reportes)", async () => {
    const r = await post({ phones: [] });
    expect(r.status).toBe(200);
    expect(r.json.phones).toEqual([]);
  });

  it("400 con payload no-array", async () => {
    const r = await post({ phones: "34604342381" });
    expect(r.status).toBe(400);
  });
});
