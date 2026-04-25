// web/lib/scraper/tripadvisor.ts — Parser del HTML de TripAdvisor.
//
// Mismo patrón que google-business.ts:
//   1. JSON-LD schema.org (Restaurant/Hotel/LocalBusiness) — preferido.
//   2. Meta tags estables (OpenGraph + <title> + canonical) como fallback.
//      Cubre name/description/website cuando TripAdvisor recorta JSON-LD.
//
// Los selectores DOM internos de TripAdvisor cambian cada 2-3 semanas y no
// se usan: con OpenGraph cubrimos los campos business-level del schema.

import { extractBusinessJsonLd, normalizeFromJsonLd } from "./_jsonld";
import { extractBusinessMeta } from "./_metatags";
import type { CanonicalBusiness } from "@/lib/onboarding-fast/canonical";

export function parseTripadvisor(html: string): Partial<CanonicalBusiness> {
  if (!html || html.length < 50) return {};

  const jsonLd = extractBusinessJsonLd(html);
  if (jsonLd) {
    return normalizeFromJsonLd(jsonLd);
  }

  return extractBusinessMeta(html);
}
