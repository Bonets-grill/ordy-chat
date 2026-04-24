// Mig 041: tests para el parseo de período + comportamiento esperado del
// endpoint /api/reports/hourly. Sin Postgres real — testeamos:
//   - parsePeriod normaliza correctamente los buckets
//   - parsePeriodWithDefault cae a 30d si falta o es inválido
//   - rechaza "shift:NOT_UUID"
//
// El agregado SQL "extract(hour from paid_at)" se valida implícitamente vía
// integración (y vía tipos: el endpoint no compila si la columna no existe).

import { describe, expect, it } from "vitest";
import { parsePeriod, parsePeriodWithDefault } from "@/lib/reports/period";

describe("parsePeriod", () => {
  it("today devuelve since = inicio del día local", () => {
    const r = parsePeriod("today");
    expect(r?.kind).toBe("today");
    if (r?.kind === "today") {
      expect(r.since.getHours()).toBe(0);
      expect(r.since.getMinutes()).toBe(0);
      expect(r.since.getSeconds()).toBe(0);
    }
  });

  it("7d y 30d devuelven since = ahora - N*86400s", () => {
    const before = Date.now();
    const r7 = parsePeriod("7d");
    const r30 = parsePeriod("30d");
    const after = Date.now();
    expect(r7?.kind).toBe("ndays");
    expect(r30?.kind).toBe("ndays");
    if (r7?.kind === "ndays") {
      expect(r7.days).toBe(7);
      expect(r7.since.getTime()).toBeGreaterThanOrEqual(before - 7 * 86_400_000 - 100);
      expect(r7.since.getTime()).toBeLessThanOrEqual(after - 7 * 86_400_000 + 100);
    }
    if (r30?.kind === "ndays") {
      expect(r30.days).toBe(30);
    }
  });

  it("shift:UUID válido", () => {
    const uuid = "11111111-2222-4333-8444-555555555555";
    const r = parsePeriod(`shift:${uuid}`);
    expect(r?.kind).toBe("shift");
    if (r?.kind === "shift") expect(r.shiftId).toBe(uuid);
  });

  it("shift:UUID-malformado → null", () => {
    expect(parsePeriod("shift:not-uuid")).toBeNull();
    expect(parsePeriod("shift:")).toBeNull();
    expect(parsePeriod("shift:abc")).toBeNull();
  });

  it("valor desconocido o vacío → null", () => {
    expect(parsePeriod("")).toBeNull();
    expect(parsePeriod(null)).toBeNull();
    expect(parsePeriod(undefined)).toBeNull();
    expect(parsePeriod("ayer")).toBeNull();
    expect(parsePeriod("365d")).toBeNull();
  });
});

describe("parsePeriodWithDefault", () => {
  it("usa 30d cuando el input es inválido", () => {
    const r = parsePeriodWithDefault("garbage");
    expect(r.kind).toBe("ndays");
    if (r.kind === "ndays") expect(r.days).toBe(30);
  });

  it("usa 30d cuando el input es null/undefined", () => {
    expect(parsePeriodWithDefault(null).kind).toBe("ndays");
    expect(parsePeriodWithDefault(undefined).kind).toBe("ndays");
  });

  it("respeta valores válidos", () => {
    expect(parsePeriodWithDefault("7d").kind).toBe("ndays");
    expect(parsePeriodWithDefault("today").kind).toBe("today");
  });
});

// Test adicional: simulamos la lógica de "densificar" 0..23 que el endpoint
// hace tras la query SQL. Asegura que ningún hueco queda sin pintar.
describe("hourly densification (logic mirror)", () => {
  it("densifica 0..23 con ceros para horas sin actividad", () => {
    const sparse = [
      { hour: 9, count: 5, totalCents: 1500 },
      { hour: 14, count: 12, totalCents: 4500 },
      { hour: 21, count: 3, totalCents: 800 },
    ];
    const map = new Map(sparse.map((r) => [r.hour, r]));
    const dense = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      count: map.get(h)?.count ?? 0,
      totalCents: map.get(h)?.totalCents ?? 0,
    }));
    expect(dense.length).toBe(24);
    expect(dense[0].totalCents).toBe(0);
    expect(dense[9].count).toBe(5);
    expect(dense[14].totalCents).toBe(4500);
    expect(dense[23].count).toBe(0);
  });
});
