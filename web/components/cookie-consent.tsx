"use client";

import { useEffect, useState } from "react";
import {
  buildConsentCookieHeaders,
  parseConsentCookie,
  type ConsentChoice,
} from "@/lib/reseller/consent";

/**
 * Banner de consentimiento de cookies.
 * AEPD-compliant: botones Aceptar/Rechazar equiprominentes (LSSI-CE art. 22.2).
 * Finalidad "atribución" = opt-in explícito para que el cookie ordy_ref se
 * active en los link de resellers.
 */
export function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const state = parseConsentCookie(document.cookie);
    setVisible(state === null);
  }, []);

  if (!visible) return null;

  const apply = (choice: ConsentChoice) => {
    const isProd = process.env.NODE_ENV === "production";
    for (const header of buildConsentCookieHeaders(choice, isProd)) {
      // document.cookie sólo acepta una cookie por asignación;
      // los headers retornados tienen el shape correcto (name=value; Path=...).
      document.cookie = header;
    }
    setVisible(false);
  };

  return (
    <div
      role="dialog"
      aria-label="Consentimiento de cookies"
      className="fixed bottom-4 left-4 right-4 z-50 rounded-xl border border-neutral-200 bg-white p-6 shadow-lg md:left-auto md:max-w-md"
    >
      <p className="text-sm text-neutral-700">
        Usamos cookies esenciales y, con tu permiso, cookies de atribución para
        rastrear referidos de nuestros partners. Lee nuestra{" "}
        <a href="/privacy" className="underline">
          política de privacidad
        </a>
        .
      </p>
      <div className="mt-4 flex gap-3">
        <button
          type="button"
          onClick={() => apply("accepted")}
          className="flex-1 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Aceptar todas
        </button>
        <button
          type="button"
          onClick={() => apply("rejected")}
          className="flex-1 rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
        >
          Rechazar todas
        </button>
      </div>
    </div>
  );
}
