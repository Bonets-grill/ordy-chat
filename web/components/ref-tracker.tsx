"use client";

import { useEffect } from "react";

/**
 * Beacon cliente: si hay cookie ordy_ref (set por middleware tras consent),
 * hace POST a /api/ref/touch con UTMs + referer. Fire-and-forget.
 * Nunca bloquea renderizado ni espera respuesta.
 *
 * Montado en layout raíz. Se ejecuta 1 vez por navegación client-side.
 */
export function RefTracker() {
  useEffect(() => {
    // Solo en top-level page loads, no en iframes
    if (window.top !== window.self) return;

    const match = document.cookie.match(/(?:^|;\s*)ordy_ref=([^;]+)/);
    const ref = match?.[1];
    if (!ref) return;

    const params = new URLSearchParams(window.location.search);
    const body = JSON.stringify({
      ref,
      utm_source: params.get("utm_source"),
      utm_medium: params.get("utm_medium"),
      utm_campaign: params.get("utm_campaign"),
      utm_term: params.get("utm_term"),
      utm_content: params.get("utm_content"),
      referer: document.referrer || null,
    });

    // Fetch con keepalive + Sec-Fetch-Dest explícito (el server lo valida).
    // sendBeacon no soporta custom headers → fetch con keepalive.
    fetch("/api/ref/touch", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Sec-Fetch-Dest": "empty",
      },
      body,
      keepalive: true,
      credentials: "same-origin",
    }).catch(() => {
      /* silent — beacon fire-and-forget */
    });
  }, []);

  return null;
}
