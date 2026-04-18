// web/lib/tax/compute.ts — Cálculo fiscal consciente del régimen.
//
// Problema que resuelve: antes `computeTotals` siempre sumaba el tax encima
// del precio (tax-exclusive). En España el PVP del menú YA INCLUYE el
// impuesto, así que hacía double-tax (bug 16,40€ → 17,55€).
//
// Ahora respeta `pricesIncludeTax`:
//   - true  → extrae el impuesto hacia atrás (base = total / (1+rate))
//   - false → suma el impuesto encima del neto (clásico B2B)

export type ComputeItem = {
  quantity: number;
  unitPriceCents: number;
  /** Si no se pasa, usa ctx.defaultRate. */
  taxRate?: number;
};

export type ComputeTenantCtx = {
  pricesIncludeTax: boolean;
  defaultRate: number;
};

export type ComputeTotals = {
  subtotalCents: number; // base imponible
  taxCents: number;      // cuota impuesto
  totalCents: number;    // total al cliente
};

export function computeTotals(
  items: ComputeItem[],
  ctx: ComputeTenantCtx,
): ComputeTotals {
  let subtotal = 0;
  let tax = 0;
  let total = 0;

  for (const item of items) {
    const lineGross = item.quantity * item.unitPriceCents;
    const rate = (item.taxRate ?? ctx.defaultRate) / 100;

    if (ctx.pricesIncludeTax) {
      // PVP ya incluye tax → extracción hacia atrás.
      const lineTax = Math.round((lineGross * rate) / (1 + rate));
      subtotal += lineGross - lineTax;
      tax += lineTax;
      total += lineGross;
    } else {
      // Neto → suma tax encima.
      const lineTax = Math.round(lineGross * rate);
      subtotal += lineGross;
      tax += lineTax;
      total += lineGross + lineTax;
    }
  }

  return { subtotalCents: subtotal, taxCents: tax, totalCents: total };
}
