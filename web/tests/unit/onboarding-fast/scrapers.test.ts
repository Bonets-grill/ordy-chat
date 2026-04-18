// web/tests/unit/onboarding-fast/scrapers.test.ts — Parsers puros con fixtures HTML offline.
//
// No hay I/O — cada test lee un .html del filesystem como string y ejecuta el
// parser. Garantiza determinismo y no requiere red en CI.

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { parseGoogleBusiness } from "@/lib/scraper/google-business";
import { parseTripadvisor } from "@/lib/scraper/tripadvisor";
import { extractBusinessJsonLd, normalizeFromJsonLd } from "@/lib/scraper/_jsonld";

const fixture = (path: string) =>
  readFileSync(new URL(`../../fixtures/${path}`, import.meta.url), "utf8");

describe("parseGoogleBusiness — fixtures con JSON-LD", () => {
  it("extrae Restaurant completo (nombre, tel, email, dirección, horario, redes, rating)", () => {
    const html = fixture("google/restaurante-jsonld.html");
    const out = parseGoogleBusiness(html);
    expect(out.name).toBe("La Taberna del Puerto");
    expect(out.description).toContain("mediterránea");
    expect(out.phone).toBe("+34 912 345 678");
    expect(out.email).toBe("reservas@tabernapuerto.es");
    expect(out.website).toBe("https://tabernapuerto.es");
    expect(out.address).toContain("Calle del Mar 12");
    expect(out.address).toContain("28001");
    expect(out.address).toContain("Madrid");
    expect(out.hours).toContain("Mo-Fr 12:00-16:00");
    expect(out.hours).toContain("Sa-Su 12:00-23:30");
    expect(out.social?.instagram).toBe("https://www.instagram.com/tabernapuerto");
    expect(out.social?.facebook).toBe("https://www.facebook.com/tabernapuerto");
    expect(out.rating).toBe(4.6);
    expect(out.reviews_count).toBe(1234);
    expect(out.payment_methods).toEqual(["Cash", "Credit Card", "Bizum"]);
  });

  it("extrae LocalBusiness desde @graph (Clínica Sonrisa)", () => {
    const html = fixture("google/clinica-jsonld-graph.html");
    const out = parseGoogleBusiness(html);
    expect(out.name).toBe("Clínica Dental Sonrisa");
    expect(out.phone).toBe("+34 911 222 333");
    expect(out.rating).toBe(4.8);
    expect(out.reviews_count).toBe(89);
  });

  it("devuelve vacío cuando no hay JSON-LD", () => {
    const html = fixture("google/sin-jsonld.html");
    const out = parseGoogleBusiness(html);
    expect(out).toEqual({});
  });

  it("devuelve vacío con HTML muy corto", () => {
    expect(parseGoogleBusiness("")).toEqual({});
    expect(parseGoogleBusiness("<html></html>")).toEqual({});
  });

  it("sanitiza prompt injection del description (fix legal/security)", () => {
    const html = fixture("google/injection-attempt.html");
    const out = parseGoogleBusiness(html);
    expect(out.name).toBe("Bar Malicioso");
    // Patrones de injection strippeados
    expect(out.description?.toLowerCase() ?? "").not.toContain("system:");
    expect(out.description?.toLowerCase() ?? "").not.toContain("ignore all previous");
    expect(out.description ?? "").not.toContain("[INST]");
    expect(out.description ?? "").not.toContain("[/INST]");
  });
});

describe("parseTripadvisor — fixtures con JSON-LD", () => {
  it("extrae Hotel completo", () => {
    const html = fixture("tripadvisor/hotel-jsonld.html");
    const out = parseTripadvisor(html);
    expect(out.name).toBe("Hotel Costa Azul");
    expect(out.website).toBe("https://hotelcostaazul.es");
    expect(out.phone).toBe("+34 965 123 456");
    expect(out.address).toContain("Paseo Marítimo 1");
    expect(out.rating).toBe(4.4);
    // ratingCount (en lugar de reviewCount) también funciona
    expect(out.reviews_count).toBe(567);
    expect(out.social?.tiktok).toBe("https://www.tiktok.com/@hotelcostaazul");
  });

  it("devuelve vacío para HTML inválido", () => {
    expect(parseTripadvisor("")).toEqual({});
  });
});

describe("_jsonld helpers", () => {
  it("extractBusinessJsonLd detecta múltiples tipos LocalBusiness", () => {
    const types = [
      "Restaurant",
      "Hotel",
      "Store",
      "FoodEstablishment",
      "CafeOrCoffeeShop",
      "Bakery",
      "BarOrPub",
    ];
    for (const t of types) {
      const html = `<script type="application/ld+json">{"@type":"${t}","name":"Test ${t}"}</script>`;
      const result = extractBusinessJsonLd(html);
      expect(result?.name).toBe(`Test ${t}`);
    }
  });

  it("extractBusinessJsonLd ignora tipos NO-business (WebSite, Organization)", () => {
    const html = `<script type="application/ld+json">{"@type":"WebSite","name":"X"}</script>`;
    expect(extractBusinessJsonLd(html)).toBeNull();
  });

  it("extractBusinessJsonLd ignora JSON malformado sin romper", () => {
    const html = `<script type="application/ld+json">{broken json</script>`;
    expect(extractBusinessJsonLd(html)).toBeNull();
  });

  it("extractBusinessJsonLd acepta array en root", () => {
    const html = `<script type="application/ld+json">[{"@type":"WebSite"},{"@type":"Restaurant","name":"OK"}]</script>`;
    const r = extractBusinessJsonLd(html);
    expect(r?.name).toBe("OK");
  });

  it("normalizeFromJsonLd acepta address como string simple", () => {
    const r = normalizeFromJsonLd({ name: "X", address: "Calle 1, Madrid" } as Record<string, unknown>);
    // address string (no objeto) se ignora — es la convención schema.org
    expect(r.address).toBeUndefined();
    expect(r.name).toBe("X");
  });

  it("normalizeFromJsonLd rechaza rating fuera de 0-5", () => {
    const r = normalizeFromJsonLd({
      name: "X",
      aggregateRating: { ratingValue: 9.9, reviewCount: 10 },
    } as Record<string, unknown>);
    expect(r.rating).toBeUndefined();
    expect(r.reviews_count).toBe(10);
  });
});
