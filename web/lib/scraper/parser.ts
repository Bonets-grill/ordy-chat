// lib/scraper/parser.ts — Extrae datos estructurados y texto limpio de HTML.

import * as cheerio from "cheerio";

export type ParsedPage = {
  url: string;
  title: string;
  description: string;
  canonicalUrl: string;
  openGraph: Record<string, string>;
  jsonLd: unknown[];
  microdata: unknown[];
  text: string;     // texto visible concatenado
  links: { href: string; text: string }[];
};

const NOISE_SELECTORS = [
  "script", "style", "noscript", "iframe", "svg", "link",
  "nav", "header nav", "footer", "[role=navigation]",
  ".cookie", ".cookies", "#cookies", "[id*=cookie]",
  ".breadcrumb", ".breadcrumbs",
  "form",
].join(",");

export function parseHtml(url: string, html: string): ParsedPage {
  const $ = cheerio.load(html);

  // Metadata
  const title = ($("title").first().text() || $("meta[property='og:title']").attr("content") || "").trim();
  const description =
    ($("meta[name='description']").attr("content") ||
     $("meta[property='og:description']").attr("content") ||
     "").trim();
  const canonicalUrl = ($("link[rel='canonical']").attr("href") || url).trim();

  const openGraph: Record<string, string> = {};
  $("meta").each((_, el) => {
    const prop = $(el).attr("property") || $(el).attr("name");
    const content = $(el).attr("content");
    if (prop && content && (prop.startsWith("og:") || prop.startsWith("twitter:"))) {
      openGraph[prop] = content;
    }
  });

  // JSON-LD
  const jsonLd: unknown[] = [];
  $("script[type='application/ld+json']").each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) jsonLd.push(...parsed);
      else jsonLd.push(parsed);
    } catch {
      // Algunos sitios tienen JSON-LD con comentarios o errores. Intentar limpieza básica.
      const cleaned = raw.replace(/^\s*\/\*.*?\*\/\s*/s, "").trim();
      try {
        jsonLd.push(JSON.parse(cleaned));
      } catch { /* skip */ }
    }
  });

  // Microdata (schema.org) — extracción ligera.
  const microdata: unknown[] = [];
  $("[itemscope]").each((_, el) => {
    const itemtype = $(el).attr("itemtype");
    const props: Record<string, string | string[]> = {};
    $(el).find("[itemprop]").each((__, p) => {
      const key = $(p).attr("itemprop");
      if (!key) return;
      let value = ($(p).attr("content") || $(p).text() || "").trim();
      if (!value && (p as { tagName?: string }).tagName === "a") value = $(p).attr("href") ?? "";
      if (!value && (p as { tagName?: string }).tagName === "img") value = $(p).attr("src") ?? "";
      if (value) {
        const existing = props[key];
        if (existing === undefined) props[key] = value;
        else if (Array.isArray(existing)) existing.push(value);
        else props[key] = [existing, value];
      }
    });
    if (Object.keys(props).length > 0) {
      microdata.push({ type: itemtype, props });
    }
  });

  // Links visibles
  const links: { href: string; text: string }[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const text = $(el).text().trim().replace(/\s+/g, " ");
    if (!text) return;
    links.push({ href, text });
  });

  // Texto limpio
  $(NOISE_SELECTORS).remove();
  // Colapsa espacios y quita entradas vacías.
  const text = $("body").text().replace(/\s+/g, " ").trim();

  return { url, title, description, canonicalUrl, openGraph, jsonLd, microdata, text, links };
}
