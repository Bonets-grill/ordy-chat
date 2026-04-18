// tests/unit/tax-compute.test.ts
import { describe, expect, it } from "vitest";
import { computeTotals } from "@/lib/tax/compute";

describe("computeTotals — tax-inclusive (PVP)", () => {
  it("regresión del bug 16,40 vs 17,55 con IVA 10%", () => {
    const r = computeTotals(
      [
        { quantity: 1, unitPriceCents: 1490, taxRate: 10 }, // Dakota Burger 14,90 PVP
        { quantity: 1, unitPriceCents: 150, taxRate: 10 },  // Bacon extra 1,50 PVP
      ],
      { pricesIncludeTax: true, defaultRate: 10 },
    );
    // Cliente paga 16,40 € exactos. Base: 16,40/1.10=14,909... IVA: 1,49.
    expect(r.totalCents).toBe(1640);
    expect(r.taxCents).toBe(149);
    expect(r.subtotalCents).toBe(1491);
  });

  it("IGIC 7% Canarias", () => {
    const r = computeTotals(
      [{ quantity: 1, unitPriceCents: 1490, taxRate: 7 }],
      { pricesIncludeTax: true, defaultRate: 7 },
    );
    // 14,90/1.07=13,9252... base 1393, IGIC 97, total 1490
    expect(r.totalCents).toBe(1490);
    expect(r.taxCents).toBe(97);
    expect(r.subtotalCents).toBe(1393);
  });

  it("IPSI 4% Ceuta/Melilla", () => {
    const r = computeTotals(
      [{ quantity: 1, unitPriceCents: 520, taxRate: 4 }],
      { pricesIncludeTax: true, defaultRate: 4 },
    );
    expect(r.totalCents).toBe(520);
    expect(r.taxCents).toBe(20);
    expect(r.subtotalCents).toBe(500);
  });

  it("tasa por línea override default (hostelería + alcohol)", () => {
    const r = computeTotals(
      [
        { quantity: 1, unitPriceCents: 1000, taxRate: 10 }, // comida
        { quantity: 1, unitPriceCents: 500, taxRate: 21 },  // alcohol
      ],
      { pricesIncludeTax: true, defaultRate: 10 },
    );
    expect(r.totalCents).toBe(1500);
    // 1000*10/110=90.90→91 + 500*21/121=86.77→87 = 178
    expect(r.taxCents).toBe(178);
  });

  it("multiples unidades", () => {
    const r = computeTotals(
      [{ quantity: 3, unitPriceCents: 1100, taxRate: 10 }],
      { pricesIncludeTax: true, defaultRate: 10 },
    );
    // 3*1100=3300 total, 3300*10/110=300 IVA, 3000 base
    expect(r.totalCents).toBe(3300);
    expect(r.taxCents).toBe(300);
  });
});

describe("computeTotals — tax-exclusive (neto B2B)", () => {
  it("suma tax encima con IVA 10%", () => {
    const r = computeTotals(
      [{ quantity: 2, unitPriceCents: 1000, taxRate: 10 }],
      { pricesIncludeTax: false, defaultRate: 10 },
    );
    // 2*10€ neto = 20€; +10% = 22€
    expect(r.subtotalCents).toBe(2000);
    expect(r.taxCents).toBe(200);
    expect(r.totalCents).toBe(2200);
  });
});

describe("computeTotals — edge cases", () => {
  it("items vacíos devuelve ceros", () => {
    const r = computeTotals([], { pricesIncludeTax: true, defaultRate: 10 });
    expect(r).toEqual({ subtotalCents: 0, taxCents: 0, totalCents: 0 });
  });

  it("item con taxRate 0 (exento)", () => {
    const r = computeTotals(
      [{ quantity: 1, unitPriceCents: 500, taxRate: 0 }],
      { pricesIncludeTax: true, defaultRate: 10 },
    );
    expect(r.totalCents).toBe(500);
    expect(r.taxCents).toBe(0);
    expect(r.subtotalCents).toBe(500);
  });

  it("taxRate undefined usa defaultRate", () => {
    const r = computeTotals(
      [{ quantity: 1, unitPriceCents: 1100 }],
      { pricesIncludeTax: true, defaultRate: 10 },
    );
    expect(r.totalCents).toBe(1100);
    expect(r.taxCents).toBe(100);
  });
});
