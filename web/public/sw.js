// web/public/sw.js — Service Worker v1 (Sprint 4 F4.1).
//
// Estrategias por tipo de request:
//   - Shell HTML (/, /signin, /dashboard…):  cache-first con Stale-While-Revalidate.
//   - Assets _next/static + /icon-*.png:     cache-first largo.
//   - APIs (/api/*):                          network-only (nunca cachear).
//   - SSE / streaming (accept: text/event-stream): bypass total.
//   - Otras (POST, PATCH, DELETE):            network-only.
//
// CACHE_VERSION cambia cada deploy (string versionada). Cuando se activa una
// versión nueva, se barren los caches con prefijo "ordy-" que no coincidan.
// skipWaiting + clients.claim permite update inmediato sin que el usuario
// tenga que cerrar pestañas.

// v2 (2026-04-22): HTML pasa a network-only. v1 hacía stale-while-revalidate
// sobre el shell, lo que servía HTML viejo apuntando a chunks CSS con hashes
// que ya no existen tras cada deploy → página sin estilos hasta que el usuario
// refrescaba. Los assets _next/static (versionados por hash, immutables) siguen
// cache-first largo, que es la estrategia correcta para ellos.
// v3 (2026-04-26): bump tras redesign visual + fixes ventas/horario/notif.
// Forzamos invalidación porque varios usuarios reportaban ver UI vieja por
// SW v2 cacheado en Safari Mac (no se renueva con simple Cmd+Shift+R).
const CACHE_VERSION = "ordy-v3-2026-04-26";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const ASSETS_CACHE = `${CACHE_VERSION}-assets`;

const SHELL_URLS = ["/", "/signin", "/pricing", "/privacy", "/terms"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      try {
        await cache.addAll(SHELL_URLS);
      } catch {
        // Si alguna URL falla en install, no bloquear. Se cacheará on-fetch.
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Limpia caches viejos (cualquier "ordy-" que no sea la versión actual).
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("ordy-") && !k.startsWith(CACHE_VERSION))
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

function isAssetRequest(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    /^\/(icon|apple-touch-icon)[-_a-z0-9]*\.(png|ico|svg)$/i.test(url.pathname)
  );
}

function isApiRequest(url) {
  return url.pathname.startsWith("/api/");
}

function isHtmlRequest(request, url) {
  const accept = request.headers.get("accept") ?? "";
  return (
    request.mode === "navigate" ||
    (accept.includes("text/html") && url.origin === self.location.origin)
  );
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((res) => {
      if (res && res.ok && res.type !== "opaque") {
        cache.put(request, res.clone()).catch(() => {});
      }
      return res;
    })
    .catch(() => null);
  return cached || (await networkPromise) || new Response("offline", { status: 503 });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Solo mismo origen. Third-party (fonts CDN, etc.) pasa sin tocar.
  if (url.origin !== self.location.origin) return;

  // Nunca cachear streaming (SSE/chat en tiempo real).
  const accept = request.headers.get("accept") ?? "";
  if (accept.includes("text/event-stream")) return;

  // Mutaciones: network-only (POST/PUT/PATCH/DELETE).
  if (request.method !== "GET") return;

  // APIs: network-only.
  if (isApiRequest(url)) return;

  // Assets estáticos: cache-first largo.
  if (isAssetRequest(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(ASSETS_CACHE);
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          const res = await fetch(request);
          if (res && res.ok) cache.put(request, res.clone()).catch(() => {});
          return res;
        } catch {
          return new Response("offline", { status: 503 });
        }
      })(),
    );
    return;
  }

  // Shell HTML: NETWORK-ONLY (v2). Stale-while-revalidate sobre HTML rompía
  // estilos tras cada deploy porque el HTML cacheado referenciaba chunks
  // CSS con hashes ya inexistentes. El "shell offline" no era real (auth +
  // DB lo requieren online), así que zero pérdida funcional.
  if (isHtmlRequest(request, url)) return;

  // Resto: network con cache fallback.
  event.respondWith(
    fetch(request).catch(async () => {
      const cache = await caches.open(SHELL_CACHE);
      return (await cache.match(request)) || new Response("offline", { status: 503 });
    }),
  );
});

// Canal update: cliente puede mandar {type:"SKIP_WAITING"} para forzar takeover.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
