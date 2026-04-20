// web/lib/scraper/website.ts — Parser para webs corporativas genéricas.
//
// Estrategia en dos pasos:
//   1. JSON-LD schema.org (LocalBusiness/Restaurant/...) — formato preferido.
//   2. Meta tags fallback (<title>, og:*, description, canonical) cuando el
//      sitio no emite JSON-LD. Cubre constructores SaaS como last.shop, Wix,
//      WordPress sin plugin SEO, Linktree.
//
// Los datos de JSON-LD tienen prioridad; meta solo rellena campos ausentes.
// El pipeline HTML → texto → Claude LLM vive en lib/scraper/extract.ts y es
// independiente de este parser.

import { extractBusinessJsonLd, normalizeFromJsonLd } from "./_jsonld";
import { extractBusinessMeta } from "./_metatags";
import type { CanonicalBusiness } from "@/lib/onboarding-fast/canonical";

export function parseWebsite(html: string): Partial<CanonicalBusiness> {
  if (!html || html.length < 50) return {};
  const jsonLd = extractBusinessJsonLd(html);
  const fromJsonLd = jsonLd ? normalizeFromJsonLd(jsonLd) : {};
  const fromMeta = extractBusinessMeta(html);
  // JSON-LD gana: si un campo está en ambos, se queda el de JSON-LD.
  return { ...fromMeta, ...fromJsonLd };
}
