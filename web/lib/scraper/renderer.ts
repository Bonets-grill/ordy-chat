// lib/scraper/renderer.ts — Playwright headless como fallback para SPAs.
//
// Se usa SOLO cuando el HTML plano devuelve un shell vacío (típico en Vue/React/
// Nuxt/Next SPA sin SSR real). Renderiza con Chromium, espera networkidle,
// scrollea para disparar lazy-load, y devuelve el HTML final.

import type { Browser } from "playwright";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 OrdyChatBot/1.0";

let _browser: Browser | null = null;
let _initPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (_browser) return _browser;
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    const { chromium } = await import("playwright");
    _browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    return _browser;
  })();
  return _initPromise;
}

export async function closeBrowser(): Promise<void> {
  if (_browser) {
    await _browser.close();
    _browser = null;
    _initPromise = null;
  }
}

export type RenderedResult = {
  url: string;
  html: string;
  durationMs: number;
  renderer: "chromium";
};

/**
 * Renderiza una URL con Chromium headless. Espera networkidle + scroll completo.
 */
export async function renderPage(url: string, timeoutMs = 25_000): Promise<RenderedResult> {
  const t0 = Date.now();
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    locale: "es-ES",
    viewport: { width: 1440, height: 900 },
    javaScriptEnabled: true,
    ignoreHTTPSErrors: false,
  });

  // Bloquea recursos pesados irrelevantes — ahorra 60-80% del tráfico.
  await context.route("**/*", (route) => {
    const type = route.request().resourceType();
    if (["image", "media", "font", "stylesheet"].includes(type)) {
      return route.abort();
    }
    return route.continue();
  });

  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: timeoutMs });
    // Scroll para disparar lazy-load de catálogos largos.
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        let total = 0;
        const step = 600;
        const id = setInterval(() => {
          window.scrollBy(0, step);
          total += step;
          if (total >= document.body.scrollHeight) {
            clearInterval(id);
            resolve();
          }
        }, 200);
      });
    });
    // Pausa corta para que frameworks reactivos hidraten nuevos nodos.
    await page.waitForTimeout(1500);
    const html = await page.content();
    return { url: page.url(), html, durationMs: Date.now() - t0, renderer: "chromium" };
  } finally {
    await context.close();
  }
}

/**
 * Detecta si un HTML plano es shell vacío de SPA y por tanto necesita renderer.
 * Heurística conservadora: solo dispara el flag si está muy claro.
 */
export function needsRender(html: string, visibleTextLen: number): boolean {
  if (visibleTextLen > 3000) return false;
  // Shells SPA típicos — div contenedor vacío.
  if (/<div\s+id=["'](?:app|root|__next|__nuxt|svelte)["'][^>]*>\s*<\/div>/i.test(html)) return true;
  // Build artifacts de Vite/Webpack sin contenido visible.
  if (/<script\s+type=["']module["']/i.test(html) && visibleTextLen < 1500) return true;
  // Generator meta de frameworks SPA sin contenido.
  if (/<meta[^>]+(nuxt|gatsby|vite)[^>]*>/i.test(html) && visibleTextLen < 1500) return true;
  return false;
}
