// web/lib/reports/pareto.ts
//
// Lógica pura del análisis 80/20 (Pareto). El endpoint /api/reports/pareto
// hace la query SQL → array { name, revenueCents } y delega aquí el cálculo.
// Vivir aparte deja la lógica testable sin tocar Postgres.
//
// Output: filas ordenadas por revenue desc con sharePct individual y
// cumulativePct (% acumulado de revenue al incluir esta fila y las
// anteriores). isParetoTop=true marca las filas que componen el primer 80%.
//
// Casos borde cubiertos por reports-pareto.test.ts:
//   - Lista vacía → output vacío + paretoCount=0 + paretoSharePct=0.
//   - Producto único → única fila, sharePct=100, cumulativePct=100,
//     isParetoTop=true (es trivialmente el 80%, no se descarta).
//   - Distribución uniforme (10 productos al mismo revenue) → ~80% del catálogo
//     entra en el top 80%.
//   - Distribución muy sesgada (un producto domina 95%) → 1 producto =
//     paretoCount=1, paretoSharePct=10% (1/10 del catálogo).

export type ParetoInput = {
  name: string;
  revenueCents: number;
};

export type ParetoRow = {
  name: string;
  revenueCents: number;
  /** % individual del total (0..100). */
  sharePct: number;
  /** % acumulado al incluir este y los anteriores (0..100). */
  cumulativePct: number;
  /** True si esta fila pertenece al primer 80% acumulado. */
  isParetoTop: boolean;
};

export type ParetoResult = {
  rows: ParetoRow[];
  totalRevenueCents: number;
  /** Cuántos productos componen el primer 80% acumulado. */
  paretoCount: number;
  /** % del catálogo que esos productos representan (0..100). */
  paretoSharePct: number;
};

/**
 * Computa el análisis Pareto sobre la lista de productos.
 *
 * Reglas:
 *   - Productos con revenueCents <= 0 se descartan (no aportan al análisis).
 *   - Si total = 0, devolvemos rows vacías y paretoCount=0.
 *   - Ordena por revenue desc (input order ignorado).
 *   - "Pareto top" = primeras filas cuyo cumulativePct cruza 80.
 *     La fila que cruza el 80% se INCLUYE (la "primera fila que llega o
 *     supera el 80%"), no se excluye — así el 80% siempre queda cubierto.
 *   - paretoSharePct = paretoCount / totalProductos × 100.
 *     Útil para el copy "el X% de tus productos genera el 80% de las ventas".
 */
export function computePareto(items: ParetoInput[]): ParetoResult {
  const filtered = items.filter((i) => i.revenueCents > 0);
  const totalRevenueCents = filtered.reduce((a, r) => a + r.revenueCents, 0);
  if (filtered.length === 0 || totalRevenueCents === 0) {
    return {
      rows: [],
      totalRevenueCents: 0,
      paretoCount: 0,
      paretoSharePct: 0,
    };
  }

  const sorted = [...filtered].sort((a, b) => b.revenueCents - a.revenueCents);
  let cumulativeCents = 0;
  let paretoCount = 0;
  let paretoCrossed = false;
  const rows: ParetoRow[] = sorted.map((it) => {
    cumulativeCents += it.revenueCents;
    const sharePct = (it.revenueCents / totalRevenueCents) * 100;
    const cumulativePct = (cumulativeCents / totalRevenueCents) * 100;
    let isParetoTop = false;
    if (!paretoCrossed) {
      // Esta fila aún cae dentro (o cruza por primera vez) el 80%. La
      // incluimos. Marcamos el flag para que las siguientes ya no entren.
      isParetoTop = true;
      paretoCount += 1;
      if (cumulativePct >= 80) paretoCrossed = true;
    }
    return {
      name: it.name,
      revenueCents: it.revenueCents,
      sharePct,
      cumulativePct,
      isParetoTop,
    };
  });

  // Si por alguna razón nunca cruzamos el 80% (no debería pasar ya que
  // sumamos 100% al final), capamos paretoCount al length.
  if (paretoCount === 0) paretoCount = rows.length;

  const paretoSharePct = (paretoCount / sorted.length) * 100;

  return {
    rows,
    totalRevenueCents,
    paretoCount,
    paretoSharePct,
  };
}
