// web/lib/reports/period.ts
//
// Helper compartido por los endpoints /api/reports/* (mig 041).
//
// Convierte un parámetro `period` que viene por query string (today | 7d | 30d
// | shift:UUID) a una representación normalizada que cada endpoint usa para
// construir la cláusula WHERE.
//
// Mantiene los buckets simples y predecibles: el dashboard de Mario nunca
// pide rangos custom — siempre uno de los 4 botones.

export type Period =
  | { kind: "today"; since: Date }
  | { kind: "ndays"; days: 7 | 30; since: Date }
  | { kind: "shift"; shiftId: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Parsea el parámetro `period` con el siguiente contrato:
 *   - "today"           → desde 00:00 LOCAL del día (cliente queda en UTC, ver nota).
 *   - "7d"              → últimos 7 días (now - 7*86400s).
 *   - "30d"             → últimos 30 días.
 *   - "shift:<UUID>"    → un turno concreto.
 *
 * Si el input es inválido, devuelve null y el endpoint responde 400.
 *
 * NOTA TZ: usamos "now - N*86400s" en UTC. España UTC+1/+2 → bordes de día
 * desplazados 1-2h. Aceptable para MVP (los reportes diarios ya usan el
 * mismo modelo en /api/reports/daily). Si Mario pide TZ Madrid exacto,
 * cambiamos a date_trunc('day', ... AT TIME ZONE 'Europe/Madrid').
 */
export function parsePeriod(input: string | null | undefined): Period | null {
  const v = (input ?? "").trim();
  if (v === "today") {
    const now = new Date();
    const since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { kind: "today", since };
  }
  if (v === "7d") {
    return { kind: "ndays", days: 7, since: new Date(Date.now() - 7 * 86_400_000) };
  }
  if (v === "30d") {
    return { kind: "ndays", days: 30, since: new Date(Date.now() - 30 * 86_400_000) };
  }
  if (v.startsWith("shift:")) {
    const id = v.slice("shift:".length);
    if (!UUID_RE.test(id)) return null;
    return { kind: "shift", shiftId: id };
  }
  return null;
}

/**
 * Default usado por endpoints que aceptan `period`. Si el query param falta,
 * caemos a "30d" (mismo default que /api/reports/daily).
 */
export function parsePeriodWithDefault(input: string | null | undefined): Period {
  return parsePeriod(input) ?? { kind: "ndays", days: 30, since: new Date(Date.now() - 30 * 86_400_000) };
}
