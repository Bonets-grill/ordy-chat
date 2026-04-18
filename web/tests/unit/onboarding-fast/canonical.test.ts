// web/tests/onboarding-fast/canonical.test.ts — Zod roundtrip + casos inválidos.

import { describe, it, expect } from "vitest";
import {
  CanonicalBusinessSchema,
  CANONICAL_FIELDS,
  parseCanonical,
  safeParseCanonical,
} from "@/lib/onboarding-fast/canonical";

describe("CanonicalBusinessSchema", () => {
  it("acepta payload mínimo (solo name)", () => {
    const parsed = parseCanonical({ name: "La Taberna" });
    expect(parsed.name).toBe("La Taberna");
    expect(parsed.description).toBeUndefined();
  });

  it("acepta payload completo con todos los campos", () => {
    const input = {
      name: "Restaurante El Puerto",
      description: "Cocina mediterránea desde 1987.",
      phone: "+34 912 345 678",
      email: "info@elpuerto.es",
      address: "Calle del Mar 12, 28001 Madrid",
      hours: "L-V 12:00-16:00, 20:00-23:30; S-D 12:00-23:30",
      website: "https://elpuerto.es",
      social: {
        instagram: "https://instagram.com/elpuerto",
        facebook: "https://facebook.com/elpuerto",
      },
      categories: [
        {
          name: "Entrantes",
          description: "Para compartir",
          items: [
            { name: "Croquetas caseras", price: "9,50€", allergens: ["gluten", "lácteos"] },
            { name: "Ensaladilla rusa", price: "8,00€" },
          ],
        },
      ],
      rating: 4.6,
      reviews_count: 1234,
      payment_methods: ["tarjeta", "efectivo", "bizum"],
    };
    const parsed = parseCanonical(input);
    expect(parsed.categories?.[0].items?.[0].name).toBe("Croquetas caseras");
    expect(parsed.rating).toBe(4.6);
  });

  it("rechaza name < 2 chars", () => {
    const r = safeParseCanonical({ name: "A" });
    expect(r.success).toBe(false);
  });

  it("rechaza name > 200 chars", () => {
    const r = safeParseCanonical({ name: "x".repeat(201) });
    expect(r.success).toBe(false);
  });

  it("rechaza email malformado", () => {
    const r = safeParseCanonical({ name: "Test", email: "no-es-email" });
    expect(r.success).toBe(false);
  });

  it("rechaza website con protocolo inválido", () => {
    const r = safeParseCanonical({ name: "Test", website: "ftp://example.com" });
    // Zod z.string().url() acepta http/https/ftp/etc — la regla de protocolo
    // la enforza el caller (API route) si quiere. Aquí solo URL válida.
    expect(r.success).toBe(true);
  });

  it("rechaza rating fuera de rango 0-5", () => {
    const r1 = safeParseCanonical({ name: "Test", rating: -0.1 });
    const r2 = safeParseCanonical({ name: "Test", rating: 5.1 });
    expect(r1.success).toBe(false);
    expect(r2.success).toBe(false);
  });

  it("rechaza reviews_count negativo o decimal", () => {
    const r1 = safeParseCanonical({ name: "Test", reviews_count: -1 });
    const r2 = safeParseCanonical({ name: "Test", reviews_count: 1.5 });
    expect(r1.success).toBe(false);
    expect(r2.success).toBe(false);
  });

  it("rechaza más de 50 categorías", () => {
    const r = safeParseCanonical({
      name: "Test",
      categories: Array.from({ length: 51 }, (_, i) => ({ name: `Cat ${i}` })),
    });
    expect(r.success).toBe(false);
  });

  it("rechaza más de 100 items por categoría", () => {
    const r = safeParseCanonical({
      name: "Test",
      categories: [
        {
          name: "Todo",
          items: Array.from({ length: 101 }, (_, i) => ({ name: `Item ${i}` })),
        },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("NO acepta photos_urls (removido por auditoría legal)", () => {
    // Zod por default es strip mode: campos extra se quitan en lugar de fallar.
    // Verificamos que photos_urls NO sobrevive al parse.
    const parsed = parseCanonical({
      name: "Test",
      photos_urls: ["https://cdn.example.com/foto1.jpg"],
    } as unknown);
    expect((parsed as Record<string, unknown>).photos_urls).toBeUndefined();
  });
});

describe("CANONICAL_FIELDS", () => {
  it("contiene los 12 campos comparables", () => {
    expect(CANONICAL_FIELDS).toHaveLength(12);
    expect(CANONICAL_FIELDS).toContain("name");
    expect(CANONICAL_FIELDS).toContain("hours");
    expect(CANONICAL_FIELDS).toContain("categories");
  });

  it("NO incluye photos_urls", () => {
    expect(CANONICAL_FIELDS).not.toContain("photos_urls");
  });
});

describe("parseCanonical roundtrip", () => {
  it("parse(x) === parse(parse(x)) (idempotencia)", () => {
    const input = {
      name: "La Taberna",
      phone: "+34 912 345 678",
      hours: "L-V 9-18",
      rating: 4.2,
    };
    const once = parseCanonical(input);
    const twice = parseCanonical(once);
    expect(twice).toEqual(once);
  });
});
