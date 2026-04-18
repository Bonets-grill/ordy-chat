// web/lib/scraper/google-business.ts — Parser del HTML de Google Business / Maps.
//
// Pure function: recibe HTML string (scrapeado por runtime/onboarding_scraper.py
// via Playwright), devuelve Partial<CanonicalBusiness>. NO hace red.
//
// Estrategia:
//   1. JSON-LD @type LocalBusiness/Restaurant/... — Google lo expone en la
//      mayoría de perfiles verificados. Formato estable.
//   2. Fallback vacío — los selectores DOM de maps.google.com cambian cada
//      2-3 semanas; más vale no retornar datos dudosos. Mejora futura:
//      añadir selectores específicos cuando identifiquemos estables.

import { extractBusinessJsonLd, normalizeFromJsonLd } from "./_jsonld";
import type { CanonicalBusiness } from "@/lib/onboarding-fast/canonical";

export function parseGoogleBusiness(html: string): Partial<CanonicalBusiness> {
  if (!html || html.length < 50) return {};

  const jsonLd = extractBusinessJsonLd(html);
  if (jsonLd) {
    return normalizeFromJsonLd(jsonLd);
  }

  // TODO: fallback con selectores DOM específicos de maps.google.com.
  // Por ahora devolvemos vacío — conocemos la limitación (ver riesgo
  // "Google cambia selectores" en el blueprint §7).
  return {};
}
