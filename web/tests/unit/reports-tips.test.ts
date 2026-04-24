// Mig 041: tests para la lógica del reporte de propinas.
//
// El endpoint /api/reports/tips hace una query SQL que devuelve agregados
// (tipCents, ordersWithTip, revenueCents) y a partir de ahí calcula:
//   - avgTipCents = round(tipCents / ordersWithTip)
//   - tipPctOfRevenue = (tipCents / revenueCents) * 100
// Con ordersWithTip=0 → avgTipCents=0; con revenueCents=0 → tipPctOfRevenue=0.
//
// Este test valida la lógica pura de transformación, sin tocar Postgres.

import { describe, expect, it } from "vitest";

/**
 * Reimplementa la transformación que hace el endpoint para poder probarla
 * sin instanciar la query. Mantener sincronizado con app/api/reports/tips/route.ts.
 */
function buildTotal(input: {
  tipCents: number;
  ordersWithTip: number;
  revenueCents: number;
}) {
  const tipCents = input.tipCents ?? 0;
  const ordersWithTip = input.ordersWithTip ?? 0;
  const revenueCents = input.revenueCents ?? 0;
  const avgTipCents = ordersWithTip > 0 ? Math.round(tipCents / ordersWithTip) : 0;
  const tipPctOfRevenue = revenueCents > 0 ? (tipCents / revenueCents) * 100 : 0;
  return { tipCents, ordersWithTip, avgTipCents, tipPctOfRevenue };
}

describe("reports/tips total computation", () => {
  it("calcula avgTipCents y tipPctOfRevenue cuando hay datos", () => {
    // 5 pedidos con propina, 25€ totales, sobre 500€ de revenue.
    const r = buildTotal({
      tipCents: 25_00,
      ordersWithTip: 5,
      revenueCents: 500_00,
    });
    expect(r.tipCents).toBe(2500);
    expect(r.ordersWithTip).toBe(5);
    expect(r.avgTipCents).toBe(500); // 5€ media
    expect(r.tipPctOfRevenue).toBeCloseTo(5, 5);
  });

  it("redondea avgTipCents al entero más cercano", () => {
    // 100 cts / 3 pedidos = 33.33... → 33.
    const r = buildTotal({
      tipCents: 100,
      ordersWithTip: 3,
      revenueCents: 1000,
    });
    expect(r.avgTipCents).toBe(33);
  });

  it("redondea hacia arriba si la fracción es >= .5", () => {
    // 105 / 2 = 52.5 → 53.
    const r = buildTotal({
      tipCents: 105,
      ordersWithTip: 2,
      revenueCents: 1000,
    });
    expect(r.avgTipCents).toBe(53);
  });

  it("avgTipCents=0 cuando no hay pedidos con propina", () => {
    const r = buildTotal({
      tipCents: 0,
      ordersWithTip: 0,
      revenueCents: 1000_00,
    });
    expect(r.avgTipCents).toBe(0);
    expect(r.tipPctOfRevenue).toBe(0);
  });

  it("tipPctOfRevenue=0 cuando revenue=0 (no hay división por cero)", () => {
    const r = buildTotal({
      tipCents: 500,
      ordersWithTip: 1,
      revenueCents: 0,
    });
    expect(r.tipPctOfRevenue).toBe(0);
    // Pero avgTipCents sí se calcula porque ordersWithTip > 0.
    expect(r.avgTipCents).toBe(500);
  });

  it("tipPctOfRevenue da 100% si propinas == revenue (caso teórico raro)", () => {
    const r = buildTotal({
      tipCents: 1000,
      ordersWithTip: 1,
      revenueCents: 1000,
    });
    expect(r.tipPctOfRevenue).toBeCloseTo(100, 5);
  });

  it("vacío total → todo en cero, sin NaN", () => {
    const r = buildTotal({
      tipCents: 0,
      ordersWithTip: 0,
      revenueCents: 0,
    });
    expect(r.tipCents).toBe(0);
    expect(r.ordersWithTip).toBe(0);
    expect(r.avgTipCents).toBe(0);
    expect(r.tipPctOfRevenue).toBe(0);
    expect(Number.isFinite(r.tipPctOfRevenue)).toBe(true);
    expect(Number.isFinite(r.avgTipCents)).toBe(true);
  });
});
