// scripts/test-scrape.ts — Prueba directa del scraper.
// Uso: pnpm tsx scripts/test-scrape.ts https://bonetsgrill.last.shop

import { scrapeBusinessUrl } from "../lib/scraper";
import { closeBrowser } from "../lib/scraper/renderer";

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error("Uso: pnpm tsx scripts/test-scrape.ts <url>");
    process.exit(1);
  }

  console.log(`→ Scrape: ${url}\n`);
  const t0 = Date.now();
  const result = await scrapeBusinessUrl(url).catch((e) => {
    console.error("Scrape falló:", (e as Error).message);
    throw e;
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`✓ ${result.pages} páginas (${result.spaPagesRendered} con Chromium) en ${secs}s\n`);
  console.log("Visitadas:");
  for (const u of result.visitedUrls) console.log("  ", u);
  console.log("\n--- Texto para el agente ---\n");
  console.log(result.text);
  console.log("\n--- JSON extraído ---\n");
  console.log(JSON.stringify(result.extracted, null, 2));

  await closeBrowser();
}

main().catch((e) => {
  console.error("ERROR:", e);
  closeBrowser().finally(() => process.exit(1));
});
