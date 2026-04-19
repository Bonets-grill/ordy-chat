// web/tests/unit/agent/closed-days.test.ts — Tests de normalización + action.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CLOSED_DAYS_MAX,
  normalizeClosedDays,
  todayInTimezone,
} from "@/lib/agent/closed-days";

describe("todayInTimezone", () => {
  it("devuelve string YYYY-MM-DD", () => {
    const today = todayInTimezone("Europe/Madrid");
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("aplica fallback Madrid cuando iana es null/vacío", () => {
    const a = todayInTimezone(null);
    const b = todayInTimezone("");
    const c = todayInTimezone("Europe/Madrid");
    expect(a).toBe(c);
    expect(b).toBe(c);
  });
});

describe("normalizeClosedDays", () => {
  let fixedNow: Date;

  beforeEach(() => {
    // Fijar "ahora" al 2026-06-15 12:00 UTC → Madrid es 14:00, mismo día.
    fixedNow = new Date("2026-06-15T12:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("filtra fechas con formato inválido", () => {
    const out = normalizeClosedDays(
      ["2026-06-20", "20-06-2026", "hoy", "2026-13-01", "2026-06-32"],
      "Europe/Madrid",
    );
    // Formatos inválidos caen. '2026-13-01' pasa el regex (no valida mes) pero es > hoy
    // y la DB lanzaría error al INSERT → este test documenta que el regex NO valida
    // rangos reales; sólo forma. La DB es la última validación.
    expect(out).toContain("2026-06-20");
    expect(out).not.toContain("20-06-2026");
    expect(out).not.toContain("hoy");
  });

  it("filtra fechas pasadas (< hoy en TZ del tenant)", () => {
    const out = normalizeClosedDays(
      ["2026-06-10", "2026-06-14", "2026-06-15", "2026-06-16"],
      "Europe/Madrid",
    );
    // hoy Madrid = 2026-06-15. 10 y 14 son pasadas.
    expect(out).toEqual(["2026-06-15", "2026-06-16"]);
  });

  it("dedupe + sort", () => {
    const out = normalizeClosedDays(
      ["2026-06-20", "2026-06-16", "2026-06-20", "2026-06-15"],
      "Europe/Madrid",
    );
    expect(out).toEqual(["2026-06-15", "2026-06-16", "2026-06-20"]);
  });

  it("aplica cap CLOSED_DAYS_MAX=60", () => {
    const many = Array.from({ length: 100 }, (_, i) => {
      const d = new Date("2026-06-15T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + i);
      return d.toISOString().slice(0, 10);
    });
    const out = normalizeClosedDays(many, "Europe/Madrid");
    expect(out).toHaveLength(CLOSED_DAYS_MAX);
    expect(out[0]).toBe("2026-06-15");
  });

  it("array vacío → array vacío", () => {
    expect(normalizeClosedDays([], "Europe/Madrid")).toEqual([]);
  });

  it("respeta TZ Canarias (hoy es 1 hora antes que Madrid)", () => {
    // 2026-06-15T00:30:00Z → Madrid 02:30 (día 15), Canarias 01:30 (día 15).
    // Mismo día, no hay edge real. Verifico que la función no crashea con tz válida.
    vi.setSystemTime(new Date("2026-06-15T00:30:00Z"));
    const out = normalizeClosedDays(["2026-06-14", "2026-06-15"], "Atlantic/Canary");
    expect(out).toEqual(["2026-06-15"]);
  });
});
