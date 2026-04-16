// lib/scraper/index.ts — Pipeline completo de scraping con fallback SPA.

import { extractWithClaude, type ExtractedData } from "./extract";
import { fetchAll, fetchHtml } from "./fetcher";
import { formatForAgent } from "./format";
import { discoverRelevant } from "./discover";
import { parseHtml, type ParsedPage } from "./parser";
import { needsRender, renderPage } from "./renderer";

export type ScrapeResult = {
  rootUrl: string;
  visitedUrls: string[];
  extracted: ExtractedData;
  text: string;
  pages: number;
  spaPagesRendered: number;
  durationMs: number;
};

export async function scrapeBusinessUrl(input: string, maxPages = 12): Promise<ScrapeResult> {
  const t0 = Date.now();
  const rootUrl = normalizeInputUrl(input);

  // 1. Home — fetch plano. Si es shell SPA, renderiza con Chromium.
  const { parsed: rootParsed, rendered: rootRendered } = await getPageSmart(rootUrl);
  let spaPagesRendered = rootRendered ? 1 : 0;

  // 2. Descubre candidatos en el HTML (renderizado si aplicó).
  const candidates = discoverRelevant(rootParsed.url, rootParsed.links, maxPages);

  // 3. Fetch plano paralelo de los candidatos.
  const flatResults = await fetchAll(candidates, 5);

  // 4. Parse + detectar cuáles necesitan render (SPA con navegación cliente).
  const parsedAll: ParsedPage[] = [rootParsed];
  const needsRenderList: string[] = [];
  for (let i = 0; i < flatResults.length; i++) {
    const r = flatResults[i];
    if (!r) continue;
    const parsed = parseHtml(r.url, r.html);
    if (needsRender(r.html, parsed.text.length)) {
      needsRenderList.push(r.url);
    } else {
      parsedAll.push(parsed);
    }
  }

  // 5. Render los SPA internos en serie (máx 4). Silencioso si Playwright
  //    no está (serverless sin browser): esos sitios quedarán sin catálogo.
  for (const url of needsRenderList.slice(0, 4)) {
    try {
      const rendered = await renderPage(url, 20_000);
      if (!rendered) break; // sin playwright no tiene sentido seguir intentando
      parsedAll.push(parseHtml(rendered.url, rendered.html));
      spaPagesRendered++;
    } catch {
      // skip
    }
  }

  const consolidated = consolidate(parsedAll);
  const extracted = await extractWithClaude(consolidated);
  const text = formatForAgent(extracted);

  return {
    rootUrl: rootParsed.url,
    visitedUrls: parsedAll.map((p) => p.url),
    extracted,
    text,
    pages: parsedAll.length,
    spaPagesRendered,
    durationMs: Date.now() - t0,
  };
}

/**
 * Fetch plano + fallback Chromium si detectamos shell SPA sin contenido.
 */
async function getPageSmart(url: string): Promise<{ parsed: ParsedPage; rendered: boolean }> {
  const flat = await fetchHtml(url);
  const parsed = parseHtml(flat.url, flat.html);

  if (needsRender(flat.html, parsed.text.length)) {
    try {
      const rendered = await renderPage(flat.url, 25_000);
      if (rendered) {
        const reparsed = parseHtml(rendered.url, rendered.html);
        if (reparsed.text.length > parsed.text.length * 1.5 || reparsed.links.length > parsed.links.length * 1.5) {
          return { parsed: reparsed, rendered: true };
        }
      }
    } catch {
      // continúa con la versión plana si el render falla o Playwright no está
    }
  }
  return { parsed, rendered: false };
}

function normalizeInputUrl(raw: string): string {
  const trimmed = raw.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const u = new URL(withScheme);
  return u.toString();
}

function consolidate(pages: ReturnType<typeof parseHtml>[]): string {
  const parts: string[] = [];

  // Bloque 1: metadata + texto por página, caps agresivos (total ~80k).
  for (const p of pages) {
    parts.push(`---PAGE ${p.url}---`);
    if (p.title) parts.push(`TITLE: ${p.title}`);
    if (p.description) parts.push(`DESC: ${p.description}`);
    if (Object.keys(p.openGraph).length > 0) {
      parts.push(`OG: ${JSON.stringify(p.openGraph).slice(0, 1500)}`);
    }
    if (p.text) {
      parts.push(p.text.slice(0, 8_000));
    }
    parts.push("");
  }

  // Bloque 2: JSON-LD (Restaurant / Menu / MenuItem estructurados).
  const allJsonLd = pages.flatMap((p) => p.jsonLd);
  if (allJsonLd.length > 0) {
    parts.push("---JSON-LD---");
    parts.push(JSON.stringify(allJsonLd).slice(0, 20_000));
  }

  // Bloque 3: Microdata.
  const allMicrodata = pages.flatMap((p) => p.microdata);
  if (allMicrodata.length > 0) {
    parts.push("---MICRODATA---");
    parts.push(JSON.stringify(allMicrodata).slice(0, 8_000));
  }

  return parts.join("\n");
}
