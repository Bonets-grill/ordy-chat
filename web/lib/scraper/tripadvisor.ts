// web/lib/scraper/tripadvisor.ts — Parser del HTML de TripAdvisor.
//
// Mismo patrón que google-business.ts: JSON-LD primero, fallback vacío.
// TripAdvisor expone schema.org Restaurant/Hotel en la mayoría de perfiles.

import { extractBusinessJsonLd, normalizeFromJsonLd } from "./_jsonld";
import type { CanonicalBusiness } from "@/lib/onboarding-fast/canonical";

export function parseTripadvisor(html: string): Partial<CanonicalBusiness> {
  if (!html || html.length < 50) return {};

  const jsonLd = extractBusinessJsonLd(html);
  if (jsonLd) {
    return normalizeFromJsonLd(jsonLd);
  }

  // TODO: fallback DOM selectors si JSON-LD desaparece.
  return {};
}
