// web/lib/scraper/website.ts — Parser JSON-LD para webs corporativas genéricas.
//
// Reutiliza _jsonld.ts. El pipeline completo HTML → texto → Claude LLM vive
// en lib/scraper/extract.ts (wizard tradicional) y fuera del scope de este
// parser. Aquí solo extraemos schema.org si está presente.

import { extractBusinessJsonLd, normalizeFromJsonLd } from "./_jsonld";
import type { CanonicalBusiness } from "@/lib/onboarding-fast/canonical";

export function parseWebsite(html: string): Partial<CanonicalBusiness> {
  if (!html || html.length < 50) return {};
  const jsonLd = extractBusinessJsonLd(html);
  if (jsonLd) return normalizeFromJsonLd(jsonLd);
  return {};
}
