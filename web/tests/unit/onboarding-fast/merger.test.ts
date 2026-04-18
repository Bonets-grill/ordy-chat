// web/tests/unit/onboarding-fast/merger.test.ts — Tests del merger determinista.
//
// El path LLM no se testa aquí (requiere API key + es costoso). El contrato
// público `mergeFuentes` cae automáticamente al determinista cuando no hay
// API key, así que testando mergeDeterministic cubrimos el camino crítico.
// La calidad del LLM se evalúa con Promptfoo (web/promptfoo/merger.eval.yaml).

import { describe, it, expect } from "vitest";
import {
  mergeDeterministic,
  equalNormalized,
  type SourceData,
} from "@/lib/onboarding-fast/merger-deterministic";

describe("equalNormalized", () => {
  it("strings con whitespace/mayúsculas distintos → iguales", () => {
    expect(equalNormalized("  Hola Mundo  ", "hola mundo")).toBe(true);
    expect(equalNormalized("La Taberna", "la   taberna")).toBe(true);
  });

  it("strings semánticamente distintos → distintos", () => {
    expect(equalNormalized("La Taberna", "El Puerto")).toBe(false);
  });

  it("objects con keys en distinto orden → iguales", () => {
    expect(
      equalNormalized({ a: 1, b: 2 }, { b: 2, a: 1 }),
    ).toBe(true);
  });

  it("arrays mismo orden → iguales; distinto orden → distintos (determinista no semántico)", () => {
    expect(equalNormalized([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(equalNormalized([1, 2, 3], [3, 2, 1])).toBe(false);
  });

  it("null y undefined son distintos de strings vacíos", () => {
    expect(equalNormalized(null, null)).toBe(true);
    expect(equalNormalized(null, undefined)).toBe(false);
    expect(equalNormalized("", null)).toBe(false);
  });

  it("numbers exactos", () => {
    expect(equalNormalized(4.6, 4.6)).toBe(true);
    expect(equalNormalized(4.6, 4.7)).toBe(false);
  });
});

describe("mergeDeterministic — sin conflictos", () => {
  it("una sola fuente → canonicos = ese campo, conflictos vacío", () => {
    const out = mergeDeterministic([
      { origin: "website", data: { name: "La Taberna", phone: "+34 912" } },
    ]);
    expect(out.canonicos.name).toBe("La Taberna");
    expect(out.canonicos.phone).toBe("+34 912");
    expect(out.conflictos).toEqual([]);
  });

  it("tres fuentes con el mismo valor → canonicos, no conflicto", () => {
    const sources: SourceData[] = [
      { origin: "website", data: { name: "La Taberna" } },
      { origin: "google", data: { name: "La Taberna" } },
      { origin: "tripadvisor", data: { name: "LA TABERNA" } },
    ];
    const out = mergeDeterministic(sources);
    expect(out.canonicos.name).toBe("La Taberna");
    expect(out.conflictos).toEqual([]);
  });

  it("ausencia NO es conflicto (2 fuentes tienen campo, 1 no)", () => {
    const sources: SourceData[] = [
      { origin: "website", data: { phone: "+34 912" } },
      { origin: "google", data: { phone: "+34 912" } },
      { origin: "tripadvisor", data: {} }, // no tiene phone
    ];
    const out = mergeDeterministic(sources);
    expect(out.canonicos.phone).toBe("+34 912");
    expect(out.conflictos).toEqual([]);
  });

  it("string vacío se trata como ausencia", () => {
    const sources: SourceData[] = [
      { origin: "website", data: { description: "" } },
      { origin: "google", data: { description: "Buen sitio" } },
    ];
    const out = mergeDeterministic(sources);
    expect(out.canonicos.description).toBe("Buen sitio");
    expect(out.conflictos).toEqual([]);
  });
});

describe("mergeDeterministic — conflictos", () => {
  it("dos valores distintos → conflicto con ambos orígenes", () => {
    const sources: SourceData[] = [
      { origin: "website", data: { hours: "L-V 9-18" } },
      { origin: "google", data: { hours: "L-D 10-22" } },
    ];
    const out = mergeDeterministic(sources);
    expect(out.canonicos.hours).toBeUndefined();
    expect(out.conflictos).toHaveLength(1);
    expect(out.conflictos[0].campo).toBe("hours");
    expect(out.conflictos[0].valores).toEqual([
      { origen: "website", valor: "L-V 9-18" },
      { origen: "google", valor: "L-D 10-22" },
    ]);
  });

  it("3 fuentes, 2 iguales + 1 distinto → conflicto con los 3", () => {
    const sources: SourceData[] = [
      { origin: "website", data: { phone: "+34 912" } },
      { origin: "google", data: { phone: "+34 912" } },
      { origin: "tripadvisor", data: { phone: "+34 999" } },
    ];
    const out = mergeDeterministic(sources);
    expect(out.conflictos).toHaveLength(1);
    expect(out.conflictos[0].valores).toHaveLength(3);
  });

  it("rating numérico distinto → conflicto", () => {
    const sources: SourceData[] = [
      { origin: "google", data: { rating: 4.6 } },
      { origin: "tripadvisor", data: { rating: 4.2 } },
    ];
    const out = mergeDeterministic(sources);
    expect(out.canonicos.rating).toBeUndefined();
    expect(out.conflictos[0].campo).toBe("rating");
  });

  it("múltiples conflictos independientes", () => {
    const sources: SourceData[] = [
      { origin: "website", data: { hours: "L-V 9-18", phone: "+34 1" } },
      { origin: "google", data: { hours: "L-D 10-22", phone: "+34 2" } },
    ];
    const out = mergeDeterministic(sources);
    expect(out.conflictos).toHaveLength(2);
    const campos = out.conflictos.map((c) => c.campo).sort();
    expect(campos).toEqual(["hours", "phone"]);
  });
});

describe("mergeDeterministic — casos borde", () => {
  it("sin fuentes → canonicos vacío + conflictos vacío", () => {
    const out = mergeDeterministic([]);
    expect(out.canonicos).toEqual({});
    expect(out.conflictos).toEqual([]);
  });

  it("fuentes con data vacía → nada", () => {
    const out = mergeDeterministic([
      { origin: "a", data: {} },
      { origin: "b", data: {} },
    ]);
    expect(out.canonicos).toEqual({});
    expect(out.conflictos).toEqual([]);
  });

  it("arrays iguales semánticamente distintos → conflicto (determinista estricto)", () => {
    // "lo de siempre" para el LLM sería igual — aquí es conflicto.
    // Es la limitación conocida del fallback; el LLM lo resuelve.
    const sources: SourceData[] = [
      { origin: "website", data: { payment_methods: ["tarjeta", "efectivo"] } },
      { origin: "google", data: { payment_methods: ["efectivo", "tarjeta"] } },
    ];
    const out = mergeDeterministic(sources);
    expect(out.conflictos).toHaveLength(1);
    expect(out.conflictos[0].campo).toBe("payment_methods");
  });

  it("objeto social con keys en distinto orden → iguales (no conflicto)", () => {
    const sources: SourceData[] = [
      { origin: "website", data: { social: { instagram: "a", facebook: "b" } } },
      { origin: "google", data: { social: { facebook: "b", instagram: "a" } } },
    ];
    const out = mergeDeterministic(sources);
    expect(out.conflictos).toEqual([]);
    expect(out.canonicos.social).toEqual({ instagram: "a", facebook: "b" });
  });
});
