// web/tests/unit/menu-modifiers.test.ts
//
// Tests del esquema Zod de modificadores. Garantizan que la API rechaza inputs
// inseguros antes de tocar la DB:
//   - price_delta_cents negativo → reject
//   - max_select < min_select → reject
//   - selectionType single con maxSelect != 1 → reject
//   - límites superiores razonables (max 100_000 cents = 1000 €)
//
// Solo importa los schemas; no monta DB ni Auth. 100% puro.
//
// Mig 051: imports apuntan a modifier-library-schema (biblioteca tenant-wide).

import { describe, expect, it } from "vitest";
import { optionInputSchema as modifierInputSchema, groupCreateSchema } from "@/lib/modifier-library-schema";

describe("modifierInputSchema — defensa contra precios negativos", () => {
  it("acepta priceDeltaCents=0 (gratis)", () => {
    const r = modifierInputSchema.safeParse({ name: "Sin cebolla", priceDeltaCents: 0 });
    expect(r.success).toBe(true);
  });

  it("acepta priceDeltaCents positivo", () => {
    const r = modifierInputSchema.safeParse({ name: "Extra queso", priceDeltaCents: 150 });
    expect(r.success).toBe(true);
  });

  it("rechaza priceDeltaCents negativo (no se permite descuento via modifier)", () => {
    const r = modifierInputSchema.safeParse({ name: "Descuento", priceDeltaCents: -100 });
    expect(r.success).toBe(false);
  });

  it("rechaza priceDeltaCents > 100_000 (1000 €) — protección anti-error de tipeo", () => {
    const r = modifierInputSchema.safeParse({ name: "Muy caro", priceDeltaCents: 1_000_000 });
    expect(r.success).toBe(false);
  });

  it("rechaza nombre vacío", () => {
    const r = modifierInputSchema.safeParse({ name: "", priceDeltaCents: 0 });
    expect(r.success).toBe(false);
  });

  it("rechaza nombre > 120 chars", () => {
    const r = modifierInputSchema.safeParse({ name: "x".repeat(121), priceDeltaCents: 0 });
    expect(r.success).toBe(false);
  });

  it("default available=true y sortOrder=0", () => {
    const r = modifierInputSchema.parse({ name: "Bacon", priceDeltaCents: 200 });
    expect(r.available).toBe(true);
    expect(r.sortOrder).toBe(0);
  });
});

describe("groupCreateSchema — coherencia min/max y single/multi", () => {
  it("acepta grupo single required con maxSelect=1", () => {
    const r = groupCreateSchema.safeParse({
      name: "Tamaño",
      selectionType: "single",
      required: true,
      minSelect: 1,
      maxSelect: 1,
      options: [],
    });
    expect(r.success).toBe(true);
  });

  it("acepta grupo single con maxSelect=null (servidor lo forzará a 1)", () => {
    const r = groupCreateSchema.safeParse({
      name: "Tamaño",
      selectionType: "single",
      options: [],
    });
    expect(r.success).toBe(true);
  });

  it("rechaza single con maxSelect=2 (DB CHECK fuerza =1, blindamos en API)", () => {
    const r = groupCreateSchema.safeParse({
      name: "Tamaño",
      selectionType: "single",
      maxSelect: 2,
      options: [],
    });
    expect(r.success).toBe(false);
  });

  it("rechaza minSelect > maxSelect", () => {
    const r = groupCreateSchema.safeParse({
      name: "Extras",
      selectionType: "multi",
      minSelect: 3,
      maxSelect: 2,
      options: [],
    });
    expect(r.success).toBe(false);
  });

  it("acepta multi sin maxSelect (sin límite)", () => {
    const r = groupCreateSchema.safeParse({
      name: "Extras",
      selectionType: "multi",
      options: [{ name: "Bacon", priceDeltaCents: 200 }],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.maxSelect).toBe(null);
  });

  it("propaga validación de modifiers anidados (delta negativo rechaza el grupo entero)", () => {
    const r = groupCreateSchema.safeParse({
      name: "Extras",
      selectionType: "multi",
      options: [
        { name: "Bacon", priceDeltaCents: 200 },
        { name: "Descuento", priceDeltaCents: -50 }, // <- rechaza
      ],
    });
    expect(r.success).toBe(false);
  });

  it("limita modifiers a 50 por grupo", () => {
    const many = Array.from({ length: 51 }, (_, i) => ({
      name: `Opt${i}`,
      priceDeltaCents: 0,
    }));
    const r = groupCreateSchema.safeParse({
      name: "Extras",
      selectionType: "multi",
      options: many,
    });
    expect(r.success).toBe(false);
  });
});
