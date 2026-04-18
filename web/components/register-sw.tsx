"use client";

// web/components/register-sw.tsx — registra el Service Worker v1 (Sprint 4 F4.1).
//
// Montado en app/layout.tsx. En web móvil y PWA instalada llama
// navigator.serviceWorker.register('/sw.js'). En Capacitor (isNativePlatform)
// se salta (el bundle no necesita SW — ya carga live URL).
// Si detecta updates nuevos, manda SKIP_WAITING y recarga.

import { useEffect } from "react";

export function RegisterSW() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    // En Capacitor skip — el WebView carga live URL + cookie.
    const isCapacitor = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
      .Capacitor?.isNativePlatform?.();
    if (isCapacitor) return;

    const controller = { cancelled: false };

    async function register() {
      try {
        const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        if (controller.cancelled) return;

        // Si ya hay un worker esperando (update pendiente de deploy anterior)
        if (reg.waiting) {
          reg.waiting.postMessage({ type: "SKIP_WAITING" });
        }

        // Escuchar nuevas instalaciones
        reg.addEventListener("updatefound", () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              // Una nueva versión está instalada y lista. Forzar takeover.
              installing.postMessage({ type: "SKIP_WAITING" });
            }
          });
        });

        // Cuando el SW toma control, recargar una vez (silent).
        let refreshing = false;
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          if (refreshing) return;
          refreshing = true;
          // Recarga solo si el usuario está en el mismo path (evita saltos feos).
          window.location.reload();
        });
      } catch (err) {
        // No romper app si falla el registro.
        console.warn("[sw] register failed:", err);
      }
    }

    register();
    return () => {
      controller.cancelled = true;
    };
  }, []);

  return null;
}
