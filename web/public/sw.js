// web/public/sw.js — kill-switch stub.
//
// Cualquier service worker legacy cacheado en iPhones/PWAs antiguos busca
// /sw.js y se queda en bucle si devolvemos 404. Este stub se activa una sola
// vez, se auto-desinstala, y fuerza reload de todas las pestañas abiertas.
// Sprint 4 (Capacitor + PWA) lo reemplazará por un SW real con cache v1+.
//
// No cachea nada, no intercepta fetch — es solo una pieza de "limpieza".

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: "window" });
      for (const client of clients) {
        try {
          client.navigate(client.url);
        } catch {
          // Ignora navegación bloqueada por CSP/COOP.
        }
      }
    })(),
  );
});
