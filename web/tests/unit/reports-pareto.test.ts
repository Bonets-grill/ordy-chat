// Mig 041: tests para el cálculo del análisis 80/20 (computePareto).
//
// Casos cubiertos (Mario):
//   - producto único → 1 producto, sharePct=100, isParetoTop=true.
//   - distribución uniforme (10 al mismo revenue) → ~80% del catálogo.
//   - distribución muy sesgada (un producto = 95%) → 1 producto = 80%.
//   - lista vacía / total=0 → output vacío.
//   - sharePct + cumulativePct suman correctamente.

import { describe, expect, it } from "vitest";
import { computePareto } from "@/lib/reports/pareto";

describe("computePareto", () => {
  it("devuelve vacío cuando no hay productos", () => {
    const r = computePareto([]);
    expect(r.rows).toEqual([]);
    expect(r.totalRevenueCents).toBe(0);
    expect(r.paretoCount).toBe(0);
    expect(r.paretoSharePct).toBe(0);
  });

  it("descarta productos con revenue <= 0", () => {
    const r = computePareto([
      { name: "real", revenueCents: 1000 },
      { name: "negative", revenueCents: -500 },
      { name: "zero", revenueCents: 0 },
    ]);
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].name).toBe("real");
    expect(r.totalRevenueCents).toBe(1000);
  });

  it("producto único: 100% individual y acumulado, marcado como pareto", () => {
    const r = computePareto([{ name: "unico", revenueCents: 5000 }]);
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].sharePct).toBeCloseTo(100, 5);
    expect(r.rows[0].cumulativePct).toBeCloseTo(100, 5);
    expect(r.rows[0].isParetoTop).toBe(true);
    expect(r.paretoCount).toBe(1);
    expect(r.paretoSharePct).toBeCloseTo(100, 5);
  });

  it("distribución uniforme (10 productos al mismo revenue): ~80% del catálogo", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      name: `p${i}`,
      revenueCents: 100,
    }));
    const r = computePareto(items);
    expect(r.rows.length).toBe(10);
    expect(r.totalRevenueCents).toBe(1000);
    // Cada producto = 10%. Tras 8 productos llevamos 80% acumulado.
    // La 8va fila es la que cruza el 80% (exacto). Se incluye.
    expect(r.paretoCount).toBe(8);
    expect(r.paretoSharePct).toBeCloseTo(80, 5);
    // Las primeras 8 marcadas, las 2 últimas no.
    expect(r.rows[0].isParetoTop).toBe(true);
    expect(r.rows[7].isParetoTop).toBe(true);
    expect(r.rows[8].isParetoTop).toBe(false);
    expect(r.rows[9].isParetoTop).toBe(false);
  });

  it("distribución muy sesgada (1 producto = 95%): paretoCount=1", () => {
    const items = [
      { name: "rey", revenueCents: 9500 },
      { name: "p1", revenueCents: 100 },
      { name: "p2", revenueCents: 100 },
      { name: "p3", revenueCents: 100 },
      { name: "p4", revenueCents: 100 },
      { name: "p5", revenueCents: 100 },
    ];
    const r = computePareto(items);
    expect(r.rows[0].name).toBe("rey");
    expect(r.rows[0].sharePct).toBeCloseTo(95, 1);
    expect(r.rows[0].cumulativePct).toBeCloseTo(95, 1);
    expect(r.rows[0].isParetoTop).toBe(true);
    // Las demás filas NO entran en el pareto top porque la primera ya cruzó 80.
    for (let i = 1; i < r.rows.length; i += 1) {
      expect(r.rows[i].isParetoTop).toBe(false);
    }
    expect(r.paretoCount).toBe(1);
    // 1 de 6 productos = ~16.67%.
    expect(r.paretoSharePct).toBeCloseTo((1 / 6) * 100, 5);
  });

  it("ordena por revenue descendente independientemente del orden de entrada", () => {
    const r = computePareto([
      { name: "low", revenueCents: 100 },
      { name: "high", revenueCents: 1000 },
      { name: "mid", revenueCents: 500 },
    ]);
    expect(r.rows.map((x) => x.name)).toEqual(["high", "mid", "low"]);
  });

  it("cumulativePct suma 100 al final (sin drift de redondeo en el último)", () => {
    const items = [
      { name: "a", revenueCents: 333 },
      { name: "b", revenueCents: 333 },
      { name: "c", revenueCents: 334 },
    ];
    const r = computePareto(items);
    // Última fila debe alcanzar 100% (los flops pueden hacer 99.999..., margen 0.001)
    expect(r.rows[r.rows.length - 1].cumulativePct).toBeGreaterThan(99.99);
    expect(r.rows[r.rows.length - 1].cumulativePct).toBeLessThanOrEqual(100);
  });

  it("marca isParetoTop hasta cruzar 80% incluyendo la fila que cruza", () => {
    // 70%, 15%, 15% → tras la 1a llevamos 70 (no llega), tras la 2a 85 (cruza).
    // La 2a fila se INCLUYE en el top. La 3a NO.
    const items = [
      { name: "a", revenueCents: 7000 },
      { name: "b", revenueCents: 1500 },
      { name: "c", revenueCents: 1500 },
    ];
    const r = computePareto(items);
    expect(r.rows[0].isParetoTop).toBe(true);
    expect(r.rows[1].isParetoTop).toBe(true);
    expect(r.rows[2].isParetoTop).toBe(false);
    expect(r.paretoCount).toBe(2);
  });
});
