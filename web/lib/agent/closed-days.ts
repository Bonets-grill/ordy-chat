// web/lib/agent/closed-days.ts — Helpers puros para reservations_closed_for.
//
// Exporta funciones puras (sin side effects). La server action vive en
// app/agent/closed-days/actions.ts y reutiliza estos helpers. Mantener
// los helpers aquí respeta la regla del guard check-use-server.mjs.

export const CLOSED_DAYS_MAX = 60;
export const CLOSED_DAYS_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Devuelve YYYY-MM-DD del "hoy" en la timezone dada (IANA). Fallback Madrid. */
export function todayInTimezone(iana: string | null | undefined): string {
  const tz = iana && iana.length > 0 ? iana : "Europe/Madrid";
  // Intl devuelve YYYY-MM-DD si usamos formatToParts con calendar gregorian.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

/**
 * Normaliza un array de fechas YYYY-MM-DD:
 *  - filtra las que no matchean formato
 *  - filtra pasadas (< hoy en tz del tenant)
 *  - dedupe
 *  - ordena ascendente
 *  - aplica cap CLOSED_DAYS_MAX
 */
export function normalizeClosedDays(
  raw: readonly string[],
  tenantTimezone: string | null | undefined,
): string[] {
  const today = todayInTimezone(tenantTimezone);
  const seen = new Set<string>();
  for (const s of raw) {
    if (typeof s !== "string") continue;
    if (!CLOSED_DAYS_DATE_RE.test(s)) continue;
    if (s < today) continue;
    seen.add(s);
  }
  return Array.from(seen).sort().slice(0, CLOSED_DAYS_MAX);
}
