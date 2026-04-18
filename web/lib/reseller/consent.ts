// web/lib/reseller/consent.ts
// Cookie consent helpers (AEPD-compliant: opt-in para atribución).
// Funciones puras — testeables sin DOM.

const CONSENT_VERSION = "v1" as const;
const CONSENT_COOKIE = "ordy_consent_v1";
const ATTRIBUTION_COOKIE = "ordy_consent_attribution";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 180; // 180 días

export type ConsentChoice = "accepted" | "rejected";

export interface ConsentState {
  version: typeof CONSENT_VERSION;
  attribution: boolean;
}

/**
 * Parsea el header Cookie y devuelve el estado de consent.
 * Retorna null si `ordy_consent_v1` no está presente (consent banner debe mostrarse).
 */
export function parseConsentCookie(header: string | null | undefined): ConsentState | null {
  if (!header) return null;
  const pairs = header.split(";").map((p) => p.trim());
  let v1: string | null = null;
  let attr: string | null = null;
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (name === CONSENT_COOKIE) v1 = value;
    else if (name === ATTRIBUTION_COOKIE) attr = value;
  }
  if (v1 === null) return null;
  return {
    version: CONSENT_VERSION,
    attribution: attr === "1",
  };
}

/**
 * Construye el/los Set-Cookie headers para persistir la elección del usuario.
 * - "accepted" → 2 cookies (consent + attribution opt-in)
 * - "rejected" → 1 cookie solo (consent, sin attribution)
 */
export function buildConsentCookieHeaders(
  choice: ConsentChoice,
  isProduction: boolean,
): string[] {
  const base = `Path=/; Max-Age=${MAX_AGE_SECONDS}; SameSite=Lax`;
  const secure = isProduction ? "; Secure" : "";
  const headers: string[] = [];
  headers.push(`${CONSENT_COOKIE}=${choice}; ${base}${secure}`);
  if (choice === "accepted") {
    headers.push(`${ATTRIBUTION_COOKIE}=1; ${base}${secure}`);
  }
  return headers;
}

/**
 * Check rápido para el middleware: ¿tiene consent opt-in para atribución?
 */
export function hasAttributionConsent(header: string | null | undefined): boolean {
  const state = parseConsentCookie(header);
  return state?.attribution === true;
}

export const CONSENT_COOKIE_NAMES = {
  consent: CONSENT_COOKIE,
  attribution: ATTRIBUTION_COOKIE,
} as const;
