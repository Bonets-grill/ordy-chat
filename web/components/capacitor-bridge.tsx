// components/capacitor-bridge.tsx — Integraciones nativas cuando corremos dentro del WebView de Capacitor.
//
// Sin deps adicionales: usa window.Capacitor.Plugins que la app nativa inyecta
// automáticamente. Si la página se abre en un navegador normal, este componente
// no hace nada.

"use client";

import { useEffect } from "react";

type CapacitorWindow = Window & {
  Capacitor?: {
    isNativePlatform?: () => boolean;
    getPlatform?: () => "ios" | "android" | "web";
    Plugins?: Record<string, Record<string, (...args: unknown[]) => unknown>>;
  };
};

export function CapacitorBridge() {
  useEffect(() => {
    const w = window as CapacitorWindow;
    const cap = w.Capacitor;
    if (!cap?.isNativePlatform?.()) return;

    const plugins = cap.Plugins ?? {};
    const platform = cap.getPlatform?.() ?? "web";

    // Marcar el html con clase para ajustes CSS específicos.
    document.documentElement.classList.add("cap-native", `cap-${platform}`);

    // Status bar: estilo claro con letras oscuras, no overlay.
    plugins.StatusBar?.setStyle?.({ style: "LIGHT" });
    if (platform === "android") {
      plugins.StatusBar?.setBackgroundColor?.({ color: "#ffffff" });
    }

    // Ocultar splash tras cargar.
    plugins.SplashScreen?.hide?.({ fadeOutDuration: 200 });

    // Back button Android → router.back() o exit si no hay historial.
    const appPlugin = plugins.App;
    let removeListener: { remove?: () => void } | undefined;
    if (platform === "android" && appPlugin?.addListener) {
      const maybeListener = appPlugin.addListener("backButton", () => {
        if (window.history.length > 1) {
          window.history.back();
        } else {
          appPlugin.exitApp?.();
        }
      });
      if (maybeListener && typeof (maybeListener as Promise<unknown>).then === "function") {
        (maybeListener as Promise<{ remove?: () => void }>).then((l) => {
          removeListener = l;
        });
      } else {
        removeListener = maybeListener as { remove?: () => void };
      }
    }

    return () => {
      removeListener?.remove?.();
    };
  }, []);

  return null;
}
