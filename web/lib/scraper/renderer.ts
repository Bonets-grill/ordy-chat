// lib/scraper/renderer.ts — Playwright headless como fallback para SPAs.
//
// Se usa SOLO cuando el HTML plano devuelve un shell vacío (típico en Vue/React/
// Nuxt/Next SPA sin SSR real). Renderiza con Chromium, espera networkidle,
// scrollea para disparar lazy-load, y devuelve el HTML final.

// Renderizado SPA en 3 modos:
// 1. En dev: Playwright local si está instalado (devDependency).
// 2. En prod: proxy al runtime Python (Railway) vía /render, que sí tiene Chromium.
// 3. Fallback: null → scraper degrada a fetch plano.

type RouteLike = {
  request: () => { resourceType: () => string };
  abort: () => Promise<void>;
  continue: () => Promise<void>;
};
type PageLike = {
  goto: (url: string, opts?: { waitUntil?: string; timeout?: number }) => Promise<unknown>;
  evaluate: <T>(fn: () => Promise<T> | T) => Promise<T>;
  waitForTimeout: (ms: number) => Promise<void>;
  content: () => Promise<string>;
  url: () => string;
};
type BrowserContextLike = {
  route: (pattern: string, handler: (route: RouteLike) => void) => Promise<void>;
  newPage: () => Promise<PageLike>;
  close: () => Promise<void>;
};
type BrowserContextOpts = {
  userAgent?: string;
  locale?: string;
  viewport?: { width: number; height: number };
  javaScriptEnabled?: boolean;
  ignoreHTTPSErrors?: boolean;
};
type BrowserLike = {
  newContext: (opts?: BrowserContextOpts) => Promise<BrowserContextLike>;
  close: () => Promise<void>;
};

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 OrdyChatBot/1.0";

let _browser: BrowserLike | null = null;
let _initPromise: Promise<BrowserLike | null> | null = null;
let _playwrightAvailable: boolean | null = null;

async function getBrowser(): Promise<BrowserLike | null> {
  if (_browser) return _browser;
  if (_playwrightAvailable === false) return null;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    try {
      const mod = await import("playwright").catch(() => null);
      if (!mod) {
        _playwrightAvailable = false;
        return null;
      }
      _playwrightAvailable = true;
      const b = await mod.chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      });
      _browser = b as unknown as BrowserLike;
      return _browser;
    } catch {
      _playwrightAvailable = false;
      return null;
    }
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
export async function renderPage(url: string, timeoutMs = 25_000): Promise<RenderedResult | null> {
  // En prod: delega al runtime Python que tiene Chromium en su Docker.
  const runtimeUrl = process.env.RUNTIME_URL;
  const internalSecret = process.env.RUNTIME_INTERNAL_SECRET;
  if (runtimeUrl && internalSecret && process.env.NODE_ENV === "production") {
    try {
      const r = await fetch(`${runtimeUrl}/render`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-internal-secret": internalSecret },
        body: JSON.stringify({ url, timeoutMs }),
        signal: AbortSignal.timeout(timeoutMs + 10_000),
      });
      if (r.ok) {
        const data = (await r.json()) as { url: string; html: string; durationMs: number };
        return { ...data, renderer: "chromium" };
      }
    } catch {
      // silent fallback
    }
  }

  const t0 = Date.now();
  const browser = await getBrowser();
  if (!browser) return null;
  const ctx = await browser.newContext({
    userAgent: USER_AGENT,
    locale: "es-ES",
    viewport: { width: 1440, height: 900 },
    javaScriptEnabled: true,
    ignoreHTTPSErrors: false,
  });

  await ctx.route("**/*", (route) => {
    const type = route.request().resourceType();
    if (["image", "media", "font", "stylesheet"].includes(type)) {
      void route.abort();
      return;
    }
    void route.continue();
  });

  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: timeoutMs });
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
    await page.waitForTimeout(1500);
    const html = await page.content();
    return { url: page.url(), html, durationMs: Date.now() - t0, renderer: "chromium" };
  } finally {
    await ctx.close();
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
