// web/lib/scraper/_metatags.ts — Fallback extractor para sitios sin JSON-LD.
//
// Muchas webs de negocio (constructores SaaS tipo last.shop, Linktree,
// WordPress sin plugin SEO, Wix) NO emiten <script type="application/ld+json">
// pero sí tienen <title>, <meta name="description">, OpenGraph y link canonical
// en el <head>. Este helper rescata los campos business-level mínimos:
// name, description, website. NO extrae menú/productos — ese contenido vive
// en microdata itemprop y requiere parser dedicado (scope separado).
//
// Se invoca SOLO cuando extractBusinessJsonLd devuelve null — ver website.ts.

import { sanitizeScrapedObject } from "@/lib/onboarding-fast/sanitize";
import type { CanonicalBusiness } from "@/lib/onboarding-fast/canonical";

export function extractBusinessMeta(html: string): Partial<CanonicalBusiness> {
  if (!html || html.length < 50) return {};

  const out: Partial<CanonicalBusiness> = {};

  const name = firstMatch(html, [
    metaContent("property", "og:site_name"),
    titleTag(),
    metaContent("property", "og:title"),
  ]);
  if (name && name.length >= 2) out.name = name;

  const description = firstMatch(html, [
    metaContent("name", "description"),
    metaContent("property", "og:description"),
  ]);
  if (description) out.description = description;

  const website = firstMatch(html, [
    linkHref("canonical"),
    metaContent("property", "og:url"),
    linkAlternateHref(),
  ]);
  if (website && isHttpUrl(website)) out.website = website;

  const sanitized = sanitizeScrapedObject(out);
  return sanitized.clean;
}

type Extractor = (html: string) => string | null;

function firstMatch(html: string, extractors: Extractor[]): string | null {
  for (const ex of extractors) {
    const raw = ex(html);
    if (!raw) continue;
    const clean = decodeEntities(raw).replace(/\s+/g, " ").trim();
    if (clean.length >= 2) return clean;
  }
  return null;
}

function titleTag(): Extractor {
  return (html) => {
    const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return m?.[1] ?? null;
  };
}

// Las regex usan charclass asimétrico: si el delimitador es `"` el contenido
// solo excluye `"` (permite apóstrofes tipo "It's"). Idem para `'`.
// Un único charclass `[^"']` truncaría descripciones con apóstrofes — bug real
// detectado por el test de last.shop (Bonets Grill description).
const QSTR = `(?:"([^"]*)"|'([^']*)')`;

function metaContent(attr: "name" | "property", value: string): Extractor {
  const esc = value.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  // Acepta ambos órdenes: `{attr}=... content=...` y `content=... {attr}=...`.
  const a = new RegExp(
    `<meta[^>]+${attr}=["']${esc}["'][^>]*content=${QSTR}`,
    "i",
  );
  const b = new RegExp(
    `<meta[^>]+content=${QSTR}[^>]*${attr}=["']${esc}["']`,
    "i",
  );
  return (html) => {
    const m = html.match(a) ?? html.match(b);
    return m ? m[1] ?? m[2] ?? null : null;
  };
}

function linkHref(rel: string): Extractor {
  const a = new RegExp(`<link[^>]+rel=["']${rel}["'][^>]*href=${QSTR}`, "i");
  const b = new RegExp(`<link[^>]+href=${QSTR}[^>]*rel=["']${rel}["']`, "i");
  return (html) => {
    const m = html.match(a) ?? html.match(b);
    return m ? m[1] ?? m[2] ?? null : null;
  };
}

function linkAlternateHref(): Extractor {
  // Primer <link rel="alternate" hreflang="..."> que aparezca. El idioma no
  // importa: el scraper solo quiere una URL canónica del dominio del negocio.
  return (html) => {
    const m = html.match(
      new RegExp(
        `<link[^>]+rel=["']alternate["'][^>]*hreflang=["'][^"']+["'][^>]*href=${QSTR}`,
        "i",
      ),
    );
    return m ? m[1] ?? m[2] ?? null : null;
  };
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
