// lib/scraper/fetcher.ts — Fetch HTTP con headers de navegador real.
//
// Sin dependencias externas (fetch nativo de Node 18+). Timeout configurable,
// sigue redirects, limita tamaño de respuesta para evitar bombs.

const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 OrdyChatBot/1.0";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export type FetchResult = {
  url: string;          // URL final después de redirects
  status: number;
  contentType: string;
  html: string;
  bytes: number;
  durationMs: number;
};

export class FetchError extends Error {
  constructor(public url: string, public status: number | null, message: string) {
    super(message);
    this.name = "FetchError";
  }
}

export async function fetchHtml(url: string, timeoutMs = 12_000): Promise<FetchResult> {
  const t0 = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": DEFAULT_UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
      },
    });

    if (!res.ok) {
      throw new FetchError(url, res.status, `HTTP ${res.status}`);
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("html") && !contentType.includes("text")) {
      throw new FetchError(url, res.status, `no-html: ${contentType}`);
    }

    const contentLengthHeader = res.headers.get("content-length");
    if (contentLengthHeader && Number(contentLengthHeader) > MAX_BYTES) {
      throw new FetchError(url, res.status, `too-large: ${contentLengthHeader}`);
    }

    // Lectura streaming con límite.
    const reader = res.body?.getReader();
    if (!reader) throw new FetchError(url, res.status, "no-body");

    const decoder = new TextDecoder("utf-8");
    let html = "";
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) {
        reader.cancel().catch(() => {});
        throw new FetchError(url, res.status, "too-large-stream");
      }
      html += decoder.decode(value, { stream: true });
    }
    html += decoder.decode();

    return {
      url: res.url,
      status: res.status,
      contentType,
      html,
      bytes,
      durationMs: Date.now() - t0,
    };
  } catch (e) {
    if (e instanceof FetchError) throw e;
    const msg = (e as Error).message ?? String(e);
    throw new FetchError(url, null, msg);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch múltiples URLs en paralelo con concurrencia limitada.
 * Errores se devuelven como undefined en la posición del array.
 */
export async function fetchAll(
  urls: string[],
  concurrency = 5,
  timeoutMs = 12_000,
): Promise<(FetchResult | null)[]> {
  const out: (FetchResult | null)[] = new Array(urls.length).fill(null);
  let cursor = 0;

  async function worker() {
    while (cursor < urls.length) {
      const i = cursor++;
      try {
        out[i] = await fetchHtml(urls[i], timeoutMs);
      } catch {
        out[i] = null;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
  return out;
}
