// lib/scraper/index.ts — Pipeline completo de scraping.

import { extractWithClaude, type ExtractedData } from "./extract";
import { fetchAll, fetchHtml } from "./fetcher";
import { formatForAgent } from "./format";
import { discoverRelevant } from "./discover";
import { parseHtml } from "./parser";

export type ScrapeResult = {
  rootUrl: string;
  visitedUrls: string[];
  extracted: ExtractedData;
  text: string;         // texto formateado para pegar al system_prompt
  pages: number;
  durationMs: number;
};

export async function scrapeBusinessUrl(input: string, maxPages = 12): Promise<ScrapeResult> {
  const t0 = Date.now();
  const rootUrl = normalizeInputUrl(input);

  const root = await fetchHtml(rootUrl);
  const rootParsed = parseHtml(root.url, root.html);

  const candidates = discoverRelevant(root.url, rootParsed.links, maxPages);
  const pagesHtml = await fetchAll(candidates, 5);

  const parsedAll = [rootParsed];
  for (let i = 0; i < pagesHtml.length; i++) {
    const r = pagesHtml[i];
    if (!r) continue;
    parsedAll.push(parseHtml(r.url, r.html));
  }

  const consolidated = consolidate(parsedAll);
  const extracted = await extractWithClaude(consolidated);
  const text = formatForAgent(extracted);

  return {
    rootUrl: root.url,
    visitedUrls: parsedAll.map((p) => p.url),
    extracted,
    text,
    pages: parsedAll.length,
    durationMs: Date.now() - t0,
  };
}

function normalizeInputUrl(raw: string): string {
  const trimmed = raw.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const u = new URL(withScheme);
  return u.toString();
}

function consolidate(pages: ReturnType<typeof parseHtml>[]): string {
  const parts: string[] = [];

  // Bloque 1: metadata por página
  for (const p of pages) {
    parts.push(`---PAGE ${p.url}---`);
    if (p.title) parts.push(`TITLE: ${p.title}`);
    if (p.description) parts.push(`DESC: ${p.description}`);
    if (Object.keys(p.openGraph).length > 0) {
      parts.push(`OG: ${JSON.stringify(p.openGraph)}`);
    }
    if (p.text) {
      // Limita cada página a 15k chars para evitar explosión.
      parts.push(p.text.slice(0, 15_000));
    }
    parts.push("");
  }

  // Bloque 2: JSON-LD (suele tener lo más estructurado: Restaurant, Menu, MenuItem)
  const allJsonLd = pages.flatMap((p) => p.jsonLd);
  if (allJsonLd.length > 0) {
    parts.push("---JSON-LD---");
    parts.push(JSON.stringify(allJsonLd, null, 0).slice(0, 40_000));
  }

  // Bloque 3: Microdata
  const allMicrodata = pages.flatMap((p) => p.microdata);
  if (allMicrodata.length > 0) {
    parts.push("---MICRODATA---");
    parts.push(JSON.stringify(allMicrodata, null, 0).slice(0, 15_000));
  }

  return parts.join("\n");
}
