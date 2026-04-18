// web/lib/onboarding-fast/merger-deterministic.ts — Fusión sin LLM.
//
// Función pura que aplica reglas de fusión determinista sobre N fuentes
// scrapeadas. Se usa:
//   a) Como fallback cuando ANTHROPIC_API_KEY no está disponible.
//   b) Como baseline para evaluar el merger LLM (Promptfoo).
//
// Reglas:
//   - Para cada campo canónico, recolectar valores no-nulos de cada fuente.
//   - 0 valores → se omite (ausencia ≠ conflicto).
//   - 1 valor → va a canonicos.
//   - ≥2 valores idénticos (por normalización) → canonicos.
//   - ≥2 valores distintos → conflicto (no decidir).

import { CANONICAL_FIELDS, type CanonicalBusiness, type CanonicalField } from "./canonical";

export type SourceData = {
  origin: string; // "website" | "google" | "tripadvisor" | ...
  data: Partial<CanonicalBusiness>;
};

export type ValorPorOrigen = {
  origen: string;
  valor: unknown;
};

export type Conflicto = {
  campo: CanonicalField;
  valores: ValorPorOrigen[];
};

export type MergerOutput = {
  canonicos: Partial<CanonicalBusiness>;
  conflictos: Conflicto[];
};

/**
 * Compara dos valores por igualdad semántica:
 *   - strings: trim + lowercase + colapso whitespace.
 *   - arrays/objects: JSON canónico (keys ordenadas).
 *   - primitivos: ===
 */
export function equalNormalized(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a === "string" && typeof b === "string") {
    return normalizeStr(a) === normalizeStr(b);
  }
  if (typeof a === "object" && typeof b === "object") {
    return canonicalJSON(a) === canonicalJSON(b);
  }
  return false;
}

function normalizeStr(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function canonicalJSON(v: unknown): string {
  if (v == null) return "null";
  if (typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) {
    return "[" + v.map(canonicalJSON).join(",") + "]";
  }
  const entries = Object.entries(v as Record<string, unknown>)
    .filter(([, val]) => val !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return "{" + entries.map(([k, val]) => JSON.stringify(k) + ":" + canonicalJSON(val)).join(",") + "}";
}

export function mergeDeterministic(sources: SourceData[]): MergerOutput {
  const canonicos: Partial<CanonicalBusiness> = {};
  const conflictos: Conflicto[] = [];

  for (const field of CANONICAL_FIELDS) {
    const valores: ValorPorOrigen[] = [];
    for (const src of sources) {
      const v = (src.data as Record<string, unknown>)[field];
      if (v === undefined || v === null) continue;
      if (typeof v === "string" && v.trim() === "") continue;
      valores.push({ origen: src.origin, valor: v });
    }

    if (valores.length === 0) continue;

    if (valores.length === 1) {
      (canonicos as Record<string, unknown>)[field] = valores[0].valor;
      continue;
    }

    // ≥2: ¿todos iguales?
    const primero = valores[0].valor;
    const todosIguales = valores.every((v) => equalNormalized(v.valor, primero));
    if (todosIguales) {
      (canonicos as Record<string, unknown>)[field] = primero;
    } else {
      conflictos.push({ campo: field, valores });
    }
  }

  return { canonicos, conflictos };
}
