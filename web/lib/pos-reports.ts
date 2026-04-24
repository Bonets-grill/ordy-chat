// web/lib/pos-reports.ts — Envío best-effort de reportes POS por WhatsApp.
//
// Mig 040. Tres tipos de reporte:
//   - shift_auto_opened  → "se abrió un turno automático al entrar el 1er pedido"
//   - shift_closed       → cierre manual desde /api/shifts/[id]/close
//   - daily_summary      → cron 23:55 Madrid cerrando turnos abiertos + resumen
//
// Mig 044:
//   - low_stock          → un plato con stock_qty <= low_stock_threshold
//
// Destinatarios: agent_configs.pos_report_phones (array). Si vacío, cae a
// agent_configs.handoff_whatsapp_phone. Si también vacío, log warn y return.
//
// Evolution es el único proveedor soportado para envío directo desde web (el
// runtime soporta más adapters pero aquí evitamos duplicar toda esa lógica).
// Si el tenant usa otro provider, logueamos y salimos sin romper — el flujo
// principal (pedido/cierre/cron) no debe bloquearse por un fallo de WA.

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentConfigs, providerCredentials } from "@/lib/db/schema";
import { descifrar } from "@/lib/crypto";

const logger = {
  info: (msg: string, ctx?: Record<string, unknown>) => console.log(`[pos-reports] ${msg}`, ctx ?? {}),
  warn: (msg: string, ctx?: Record<string, unknown>) => console.warn(`[pos-reports] ${msg}`, ctx ?? {}),
  error: (msg: string, ctx?: Record<string, unknown>) => console.error(`[pos-reports] ${msg}`, ctx ?? {}),
};

// ── Payload types ─────────────────────────────────────────────

export type ShiftAutoOpenedPayload = {
  openedAt: Date;
  panelUrl: string;
};

export type ShiftClosedPayload = {
  openedAt: Date;
  closedAt: Date;
  orderCount: number;
  totalCents: number;
  openingCashCents: number;
  /** Solo la parte en efectivo. Si payment_method no existe en DB, queda null y el mensaje degrada a "Cobrado total". */
  cashCents: number | null;
  cardCents: number | null;
  otherCents: number | null;
  expectedCashCents: number;
  countedCashCents: number;
  diffCents: number;
  /** Top 3 items: nombre + qty. */
  topItems: Array<{ name: string; quantity: number }>;
};

export type DailySummaryPayload = {
  /** ISO date YYYY-MM-DD en TZ Madrid. */
  date: string;
  orderCount: number;
  totalCents: number;
  cashCents: number | null;
  cardCents: number | null;
  /** Una línea por turno del día, ya formateada ("🕗 09:00-14:30 · 12 pedidos · 280€"). */
  shiftLines: string[];
  /** Top 5 items del día. */
  topItems: Array<{ name: string; quantity: number }>;
};

/** Mig 044: alerta cuando un item baja de su low_stock_threshold. */
export type LowStockPayload = {
  /** Nombre del plato (string libre, igual que en menu_items). */
  name: string;
  /** Stock restante tras el decremento. */
  stockQty: number;
  /** Umbral configurado por el tenant. */
  threshold: number;
};

export type PosReportKind = "shift_auto_opened" | "shift_closed" | "daily_summary" | "low_stock";

export type PosReportPayload =
  | { kind: "shift_auto_opened"; data: ShiftAutoOpenedPayload }
  | { kind: "shift_closed"; data: ShiftClosedPayload }
  | { kind: "daily_summary"; data: DailySummaryPayload }
  | { kind: "low_stock"; data: LowStockPayload };

// ── Formatting helpers ────────────────────────────────────────

function euros(cents: number | null | undefined): string {
  if (cents == null) return "—";
  const v = cents / 100;
  return `${v.toFixed(2).replace(/\.00$/, "")} €`;
}

function hhmm(d: Date): string {
  // Hora en TZ Madrid.
  return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid", hour12: false });
}

function yyyyMmDd(d: Date): string {
  // Fecha en TZ Madrid (formato ISO-like para headers).
  const f = new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Madrid" });
  return f.format(d);
}

function topShortList(items: Array<{ name: string; quantity: number }>, limit: number): string {
  if (!items || items.length === 0) return "—";
  return items
    .slice(0, limit)
    .map((i) => `${i.name} ×${i.quantity}`)
    .join(" · ");
}

// ── Message builders (exportados para tests) ──────────────────

export function buildShiftAutoOpenedMessage(p: ShiftAutoOpenedPayload): string {
  return [
    "🔔 Ordy Chat · Turno auto-abierto",
    "",
    "Entró el primer pedido del día y no había turno abierto.",
    `He abierto uno automático a las ${hhmm(p.openedAt)} con caja inicial 0 €.`,
    "",
    "Ajusta el efectivo inicial si corresponde desde el panel:",
    p.panelUrl,
  ].join("\n");
}

export function buildShiftClosedMessage(p: ShiftClosedPayload): string {
  const otrosLine =
    p.otherCents != null && p.otherCents > 0
      ? `🧾 Otros (transfer/vale): ${euros(p.otherCents)}`
      : null;

  // Si no hay breakdown (payment_method no existe todavía en DB), degradamos.
  const hasBreakdown = p.cashCents != null || p.cardCents != null;
  const breakdownBlock = hasBreakdown
    ? [
        `💵 Efectivo cobrado: ${euros(p.cashCents ?? 0)}`,
        `💳 Tarjeta: ${euros(p.cardCents ?? 0)}`,
        ...(otrosLine ? [otrosLine] : []),
      ]
    : [`💶 Cobrado total: ${euros(p.totalCents)}`];

  const diffBadge = p.diffCents === 0 ? "✅" : p.diffCents > 0 ? "🟢" : "🔴";
  const diffLabel = p.diffCents > 0 ? `+${euros(p.diffCents)}` : euros(p.diffCents);

  return [
    "✅ Ordy Chat · Turno cerrado",
    "",
    `📅 ${yyyyMmDd(p.openedAt)} · ${hhmm(p.openedAt)} → ${hhmm(p.closedAt)}`,
    `🧾 ${p.orderCount} pedidos · ${euros(p.totalCents)}`,
    "",
    `💵 Caja inicial: ${euros(p.openingCashCents)}`,
    ...breakdownBlock,
    "",
    `💵 Esperado caja: ${euros(p.expectedCashCents)}`,
    `💵 Contado: ${euros(p.countedCashCents)}`,
    `${diffBadge} Diferencia: ${diffLabel}`,
    "",
    `🏆 Top: ${topShortList(p.topItems, 3)}`,
  ].join("\n");
}

export function buildDailySummaryMessage(p: DailySummaryPayload): string {
  const hasBreakdown = p.cashCents != null || p.cardCents != null;
  const breakdownBlock = hasBreakdown
    ? [
        `💵 Efectivo del día: ${euros(p.cashCents ?? 0)}`,
        `💳 Tarjeta del día: ${euros(p.cardCents ?? 0)}`,
      ]
    : [`💶 Cobrado total: ${euros(p.totalCents)}`];

  return [
    "🌙 Ordy Chat · Resumen del día",
    "",
    `📅 ${p.date}`,
    `🧾 ${p.orderCount} pedidos · ${euros(p.totalCents)}`,
    "",
    ...(p.shiftLines.length > 0 ? p.shiftLines : ["(sin turnos registrados)"]),
    ...breakdownBlock,
    "",
    `🏆 Top 5: ${topShortList(p.topItems, 5)}`,
  ].join("\n");
}

/** Mig 044 — mensaje de alerta de stock bajo. */
export function buildLowStockMessage(p: LowStockPayload): string {
  return [
    "⚠️ Ordy Chat · Stock bajo",
    "",
    `El plato "${p.name}" tiene solo ${p.stockQty} unidades restantes.`,
    `Threshold configurado: ${p.threshold}.`,
    "Repón antes de que se agote o cambia el stock en la carta.",
  ].join("\n");
}

export function buildMessage(payload: PosReportPayload): string {
  switch (payload.kind) {
    case "shift_auto_opened":
      return buildShiftAutoOpenedMessage(payload.data);
    case "shift_closed":
      return buildShiftClosedMessage(payload.data);
    case "daily_summary":
      return buildDailySummaryMessage(payload.data);
    case "low_stock":
      return buildLowStockMessage(payload.data);
  }
}

// ── Destinatarios ────────────────────────────────────────────

/**
 * Resuelve la lista de teléfonos que reciben el reporte para un tenant.
 * 1. agent_configs.pos_report_phones (array) — si tiene al menos 1 entrada válida.
 * 2. fallback: agent_configs.handoff_whatsapp_phone (un solo número).
 * 3. si ambos vacíos: [].
 *
 * Normalización: quita '+', trim, descarta vacíos.
 */
export function resolveRecipients(cfg: {
  posReportPhones?: string[] | null;
  handoffWhatsappPhone?: string | null;
}): string[] {
  const configured = (cfg.posReportPhones ?? [])
    .map((p) => (p ?? "").trim().replace(/^\+/, ""))
    .filter((p) => p.length >= 6);
  if (configured.length > 0) return configured;

  const fallback = (cfg.handoffWhatsappPhone ?? "").trim().replace(/^\+/, "");
  return fallback.length >= 6 ? [fallback] : [];
}

// ── Envío Evolution (único adapter soportado desde web) ──────

async function sendViaEvolution(instanceName: string, phone: string, message: string): Promise<boolean> {
  const baseUrl = (process.env.EVOLUTION_API_URL || "").replace(/\/$/, "");
  const apiKey = process.env.EVOLUTION_API_KEY || "";
  if (!baseUrl || !apiKey || !instanceName) {
    logger.warn("evolution config ausente", {
      hasUrl: Boolean(baseUrl),
      hasKey: Boolean(apiKey),
      hasInstance: Boolean(instanceName),
    });
    return false;
  }
  try {
    const res = await fetch(`${baseUrl}/message/sendText/${instanceName}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: apiKey },
      body: JSON.stringify({ number: phone, text: message }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      logger.error("evolution send !ok", { status: res.status, phoneTail: phone.slice(-4) });
      return false;
    }
    return true;
  } catch (err) {
    logger.error("evolution send threw", { err: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

// ── Entry point ──────────────────────────────────────────────

/**
 * Envía un reporte POS a los destinatarios configurados del tenant.
 * Best-effort: nunca lanza. Logs de warn/error si falla.
 *
 * Parameter shape: (tenantId, kind, data) — el caller pasa el `kind` por
 * separado para que TS estreche el tipo de `data` sin ceremonial.
 */
export async function sendPosReport(
  tenantId: string,
  kind: "shift_auto_opened",
  data: ShiftAutoOpenedPayload,
): Promise<void>;
export async function sendPosReport(
  tenantId: string,
  kind: "shift_closed",
  data: ShiftClosedPayload,
): Promise<void>;
export async function sendPosReport(
  tenantId: string,
  kind: "daily_summary",
  data: DailySummaryPayload,
): Promise<void>;
export async function sendPosReport(
  tenantId: string,
  kind: "low_stock",
  data: LowStockPayload,
): Promise<void>;
export async function sendPosReport(
  tenantId: string,
  kind: PosReportKind,
  data: ShiftAutoOpenedPayload | ShiftClosedPayload | DailySummaryPayload | LowStockPayload,
): Promise<void> {
  try {
    const [cfg] = await db
      .select({
        posReportPhones: agentConfigs.posReportPhones,
        handoffWhatsappPhone: agentConfigs.handoffWhatsappPhone,
      })
      .from(agentConfigs)
      .where(eq(agentConfigs.tenantId, tenantId))
      .limit(1);

    const recipients = resolveRecipients({
      posReportPhones: cfg?.posReportPhones,
      handoffWhatsappPhone: cfg?.handoffWhatsappPhone,
    });
    if (recipients.length === 0) {
      logger.warn("sin destinatarios — skip", { tenantId, kind });
      return;
    }

    const [creds] = await db
      .select({
        provider: providerCredentials.provider,
        credentialsEncrypted: providerCredentials.credentialsEncrypted,
      })
      .from(providerCredentials)
      .where(eq(providerCredentials.tenantId, tenantId))
      .limit(1);
    if (!creds) {
      logger.warn("sin provider_credentials — skip", { tenantId, kind });
      return;
    }
    if (creds.provider !== "evolution") {
      logger.warn("provider no soportado desde web — skip", { tenantId, kind, provider: creds.provider });
      return;
    }

    let instanceName = "";
    try {
      const parsed = JSON.parse(descifrar(creds.credentialsEncrypted));
      instanceName = String(parsed?.instance_name ?? "");
    } catch (err) {
      logger.error("descifrar creds falló", { tenantId, err: err instanceof Error ? err.message : String(err) });
      return;
    }
    if (!instanceName) {
      logger.warn("instance_name vacío — skip", { tenantId });
      return;
    }

    const message = buildMessage({ kind, data } as PosReportPayload);

    for (const phone of recipients) {
      const ok = await sendViaEvolution(instanceName, phone, message);
      if (ok) {
        logger.info("enviado", { tenantId, kind, phoneTail: phone.slice(-4) });
      }
    }
  } catch (err) {
    // Fire-and-forget: NUNCA lanzamos. El caller no debe bloquearse.
    logger.error("sendPosReport threw", { tenantId, kind, err: err instanceof Error ? err.message : String(err) });
  }
}

// ── Fire-and-forget helper ────────────────────────────────────

/**
 * Dispara sendPosReport sin await, atrapando cualquier error interno que
 * escape. Útil dentro de un route handler cuya respuesta no debe esperar
 * al WA.
 */
export function queuePosReport(
  tenantId: string,
  kind: "shift_auto_opened",
  data: ShiftAutoOpenedPayload,
): void;
export function queuePosReport(
  tenantId: string,
  kind: "shift_closed",
  data: ShiftClosedPayload,
): void;
export function queuePosReport(
  tenantId: string,
  kind: "daily_summary",
  data: DailySummaryPayload,
): void;
export function queuePosReport(
  tenantId: string,
  kind: "low_stock",
  data: LowStockPayload,
): void;
export function queuePosReport(
  tenantId: string,
  kind: PosReportKind,
  data: ShiftAutoOpenedPayload | ShiftClosedPayload | DailySummaryPayload | LowStockPayload,
): void {
  // No await — vive fuera del lifecycle del request. Envolvemos en
  // Promise.resolve().then para que cualquier throw síncrono no rompa al caller.
  Promise.resolve()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .then(() => sendPosReport(tenantId, kind as any, data as any))
    .catch((err) => {
      logger.error("queuePosReport swallow", {
        tenantId,
        kind,
        err: err instanceof Error ? err.message : String(err),
      });
    });
}
