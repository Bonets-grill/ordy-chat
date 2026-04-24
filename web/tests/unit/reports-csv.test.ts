// web/tests/unit/reports-csv.test.ts
//
// Tests del helper compartido de CSV (csvEscape, centsToAmount, csvFilename,
// csvJoin) y del endpoint /api/reports/daily/export.
//
// Mockeamos @/lib/auth, @/lib/tenant y @/lib/db para no tocar Postgres real:
// validamos el shape del CSV devuelto (headers, columnas, escaping).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { centsToAmount, csvEscape, csvFilename, csvJoin } from "@/lib/csv";

// ─── csvEscape ───────────────────────────────────────────
describe("csvEscape", () => {
  it("deja strings simples sin tocar", () => {
    expect(csvEscape("hola")).toBe("hola");
    expect(csvEscape("Dakota Burger")).toBe("Dakota Burger");
  });

  it("envuelve en comillas cuando hay coma", () => {
    expect(csvEscape("hola, mundo")).toBe('"hola, mundo"');
  });

  it("escapa comillas dobles duplicándolas + envuelve", () => {
    expect(csvEscape('El "gran" cliente')).toBe('"El ""gran"" cliente"');
  });

  it("envuelve cuando hay salto de línea LF", () => {
    expect(csvEscape("linea1\nlinea2")).toBe('"linea1\nlinea2"');
  });

  it("envuelve cuando hay salto de línea CR", () => {
    expect(csvEscape("linea1\rlinea2")).toBe('"linea1\rlinea2"');
  });

  it("string vacío queda vacío", () => {
    expect(csvEscape("")).toBe("");
  });

  it("combina coma + comillas correctamente", () => {
    expect(csvEscape('a,"b",c')).toBe('"a,""b"",c"');
  });
});

// ─── centsToAmount ───────────────────────────────────────
describe("centsToAmount", () => {
  it("convierte 1640 → '16.40'", () => {
    expect(centsToAmount(1640)).toBe("16.40");
  });

  it("convierte 0 → '0.00'", () => {
    expect(centsToAmount(0)).toBe("0.00");
  });

  it("convierte 5 → '0.05' (zero-pad)", () => {
    expect(centsToAmount(5)).toBe("0.05");
  });

  it("maneja negativos", () => {
    expect(centsToAmount(-250)).toBe("-2.50");
  });

  it("null/undefined → string vacío (no rompe CSV)", () => {
    expect(centsToAmount(null)).toBe("");
    expect(centsToAmount(undefined)).toBe("");
  });
});

// ─── csvJoin ─────────────────────────────────────────────
describe("csvJoin", () => {
  it("devuelve sólo header si no hay filas", () => {
    expect(csvJoin(["a", "b"], [])).toBe("a,b");
  });

  it("une header + filas con \\n", () => {
    expect(csvJoin(["a", "b"], [["1", "2"], ["3", "4"]])).toBe("a,b\n1,2\n3,4");
  });
});

// ─── csvFilename ─────────────────────────────────────────
describe("csvFilename", () => {
  it("incluye base + slug + fecha ISO", () => {
    const f = csvFilename({
      base: "ventas-por-dia",
      tenantSlug: "bonets-grill",
      date: new Date("2026-04-24T12:00:00Z"),
    });
    expect(f).toBe("ventas-por-dia-bonets-grill-2026-04-24.csv");
  });

  it("sanea caracteres raros en el slug", () => {
    const f = csvFilename({
      base: "turno",
      tenantSlug: "Bonets Grill!",
      id: "abc123def456",
      date: new Date("2026-04-24T12:00:00Z"),
    });
    // espacios/especiales → guión, bajado a minúsculas, id cortado a 8 chars
    expect(f).toBe("turno-bonets-grill-2026-04-24-abc123de.csv");
  });

  it("sin slug ni id funciona", () => {
    const f = csvFilename({ base: "x", date: new Date("2026-04-24T00:00:00Z") });
    expect(f).toBe("x-2026-04-24.csv");
  });
});

// ─── /api/reports/daily/export endpoint shape ───────────
// Mocks declarados ANTES de importar la route (hoisted con vi.mock).
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenant: vi.fn() }));
vi.mock("@/lib/db", () => {
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    orderBy: vi.fn(),
  };
  return {
    db: {
      select: vi.fn(() => selectChain),
    },
  };
});

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { requireTenant } from "@/lib/tenant";

type MockFn = ReturnType<typeof vi.fn>;
type SelectChain = {
  from: MockFn;
  where: MockFn;
  groupBy: MockFn;
  orderBy: MockFn;
};
// Compound type: callable (devuelve SelectChain) + MockFn (mockClear/mockReset).
type MockSelect = MockFn & ((...args: unknown[]) => SelectChain);
const mockAuth = auth as unknown as MockFn;
const mockRequireTenant = requireTenant as unknown as MockFn;
const mockDb = db as unknown as { select: MockSelect };

describe("GET /api/reports/daily/export", () => {
  beforeEach(() => {
    mockAuth.mockReset();
    mockRequireTenant.mockReset();
    mockDb.select.mockClear();
  });

  it("401 si no hay sesión", async () => {
    mockAuth.mockResolvedValue(null);
    const { GET } = await import("@/app/api/reports/daily/export/route");
    const res = await GET(new Request("http://x/api/reports/daily/export"));
    expect(res.status).toBe(401);
  });

  it("404 si no hay tenant", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } });
    mockRequireTenant.mockResolvedValue(null);
    const { GET } = await import("@/app/api/reports/daily/export/route");
    const res = await GET(new Request("http://x/api/reports/daily/export"));
    expect(res.status).toBe(404);
  });

  it("devuelve CSV válido con columnas correctas", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } });
    mockRequireTenant.mockResolvedValue({
      tenant: { id: "t1", slug: "bonets-grill" },
      config: null,
      trialDaysLeft: 0,
    });
    // El select-chain termina en orderBy → devolvemos las filas ahí.
    const chain = mockDb.select() as unknown as {
      from: ReturnType<typeof vi.fn>;
      where: ReturnType<typeof vi.fn>;
      groupBy: ReturnType<typeof vi.fn>;
      orderBy: ReturnType<typeof vi.fn>;
    };
    chain.orderBy = vi.fn().mockResolvedValue([
      { day: "2026-04-24", count: 12, total: 16400, avg: 1367 },
      { day: "2026-04-23", count: 8, total: 10000, avg: 1250 },
    ]);

    const { GET } = await import("@/app/api/reports/daily/export/route");
    const res = await GET(new Request("http://x/api/reports/daily/export?days=30"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    const disposition = res.headers.get("Content-Disposition") ?? "";
    expect(disposition).toContain("attachment");
    expect(disposition).toContain("bonets-grill");
    expect(disposition).toMatch(/\.csv"?$/);

    const body = await res.text();
    const lines = body.split("\n");
    // Header + 2 filas.
    expect(lines[0]).toBe("day,orders_count,total_cents,avg_ticket_cents");
    expect(lines[1]).toBe("2026-04-24,12,164.00,13.67");
    expect(lines[2]).toBe("2026-04-23,8,100.00,12.50");
  });

  it("CSV con 0 filas sólo trae header", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1" } });
    mockRequireTenant.mockResolvedValue({
      tenant: { id: "t1", slug: "x" },
      config: null,
      trialDaysLeft: 0,
    });
    const chain = mockDb.select() as unknown as {
      from: ReturnType<typeof vi.fn>;
      where: ReturnType<typeof vi.fn>;
      groupBy: ReturnType<typeof vi.fn>;
      orderBy: ReturnType<typeof vi.fn>;
    };
    chain.orderBy = vi.fn().mockResolvedValue([]);

    const { GET } = await import("@/app/api/reports/daily/export/route");
    const res = await GET(new Request("http://x/api/reports/daily/export"));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toBe("day,orders_count,total_cents,avg_ticket_cents");
  });
});
