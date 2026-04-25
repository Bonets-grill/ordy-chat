// web/lib/scraper/google-business.ts — Parser del HTML de Google Business / Maps.
//
// Pure function: recibe HTML string (scrapeado por runtime/onboarding_scraper.py
// via Playwright), devuelve Partial<CanonicalBusiness>. NO hace red.
//
// Estrategia:
//   1. JSON-LD @type LocalBusiness/Restaurant/... — Google lo expone en la
//      mayoría de perfiles verificados. Formato estable.
//   2. Meta tags estables (OpenGraph + <title> + canonical) como fallback.
//      Cubre name/description/website cuando Google omite JSON-LD.
//
// Selectores DOM internos de maps.google.com siguen sin usarse a propósito:
// cambian cada 2-3 semanas y romperían la pipeline. OpenGraph es estable.

import { extractBusinessJsonLd, normalizeFromJsonLd } from "./_jsonld";
import { extractBusinessMeta } from "./_metatags";
import type { CanonicalBusiness } from "@/lib/onboarding-fast/canonical";

export function parseGoogleBusiness(html: string): Partial<CanonicalBusiness> {
  if (!html || html.length < 50) return {};

  const jsonLd = extractBusinessJsonLd(html);
  if (jsonLd) {
    return normalizeFromJsonLd(jsonLd);
  }

  return extractBusinessMeta(html);
}
