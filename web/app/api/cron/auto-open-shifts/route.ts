// web/app/api/cron/auto-open-shifts/route.ts — Vercel Cron cada 5 min.
//
// 2026-04-26 (Mario decisión): los turnos POS se abren automáticamente
// cuando el negocio entra dentro de su horario configurado en
// agent_configs.schedule. El cierre sigue siendo MANUAL (botón en
// /dashboard/turno) y bloqueado si hay cuentas abiertas.
//
// Este cron:
//   1. Lista tenants con subscription_status en ('active','trialing','trial').
//   2. Para cada uno: lee agent_configs.schedule + tenants.timezone.
//   3. Si isWithinSchedule(...).open === true Y no hay turno abierto →
//      INSERT shifts(opened_by='auto', opening_cash_cents=0, auto_opened=true).
//   4. Dispara queuePosReport(... shift_auto_opened ...) para WA al dueño
//      con link al panel /dashboard/turno donde puede registrar el efectivo
//      inicial real (override del 0 inicial) si quiere.
//
// Idempotente: si ya hay un turno abierto, no inserta nada.
// Frecuencia: cada 5 min (window mínima de retraso al abrir = 5 min, OK).

import { and, eq, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { agentConfigs, shifts, tenants } from "@/lib/db/schema";
import { validateCronAuth } from "@/lib/cron";
import { queuePosReport } from "@/lib/pos-reports";
import { isWithinSchedule } from "@/lib/schedule";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CandidateRow = {
  tenantId: string;
  schedule: string | null;
  timezone: string | null;
};

export async function GET(req: Request) {
  const unauthorized = validateCronAuth(req);
  if (unauthorized) return unauthorized;

  // Tenants activos sin turno abierto. Joineamos con agent_configs para
  // obtener el schedule. Si un tenant no tiene agent_config aún (raro,
  // pasaría solo si onboarding incompleto), el LEFT JOIN devuelve schedule
  // NULL y el helper isWithinSchedule lo trata como "siempre abierto".
  const candidates = (await db.execute(sql`
    SELECT
      t.id::text AS "tenantId",
      ac.schedule AS "schedule",
      t.timezone AS "timezone"
    FROM tenants t
    LEFT JOIN agent_configs ac ON ac.tenant_id = t.id
    WHERE t.subscription_status IN ('active','trialing','trial')
      AND NOT EXISTS (
        SELECT 1 FROM shifts s
         WHERE s.tenant_id = t.id
           AND s.closed_at IS NULL
      )
  `)) as unknown as CandidateRow[];

  const now = new Date();
  const opened: Array<{ tenantId: string; shiftId: string }> = [];
  const skipped: Array<{ tenantId: string; reason: string }> = [];

  for (const row of candidates) {
    const tz = row.timezone ?? "Atlantic/Canary";
    const status = isWithinSchedule(row.schedule, now, tz);
    if (!status.open) {
      skipped.push({ tenantId: row.tenantId, reason: status.reason });
      continue;
    }

    try {
      const [created] = await db
        .insert(shifts)
        .values({
          tenantId: row.tenantId,
          openingCashCents: 0,
          openedBy: "cron:auto-open",
          autoOpened: true,
        })
        .returning({ id: shifts.id });

      if (created?.id) {
        opened.push({ tenantId: row.tenantId, shiftId: created.id });

        // Aviso fire-and-forget al dueño.
        const panelBase =
          process.env.NEXT_PUBLIC_APP_URL ||
          process.env.APP_URL ||
          "https://ordychat.ordysuite.com";
        queuePosReport(row.tenantId, "shift_auto_opened", {
          openedAt: now,
          panelUrl: `${panelBase.replace(/\/$/, "")}/dashboard/turno`,
        });
      }
    } catch (err) {
      // Race: otra ejecución del cron o el endpoint manual /api/shifts/open
      // abrió justo en paralelo. No es error, simplemente saltamos.
      const msg = err instanceof Error ? err.message : String(err);
      skipped.push({ tenantId: row.tenantId, reason: `insert_failed:${msg.slice(0, 80)}` });
    }
  }

  // Smoke: contamos cuántos shifts abiertos quedan tras esta ejecución
  // (útil para monitoring del cron en logs Vercel).
  const [{ openCount }] = (await db
    .select({ openCount: sql<number>`count(*)::int` })
    .from(shifts)
    .where(and(eq(shifts.tenantId, sql`${shifts.tenantId}`), isNull(shifts.closedAt))))
    .concat([{ openCount: 0 }]);

  return NextResponse.json({
    ok: true,
    candidates: candidates.length,
    opened: opened.length,
    skipped: skipped.length,
    totalOpenShifts: openCount ?? 0,
    sample: { opened: opened.slice(0, 5), skipped: skipped.slice(0, 5) },
    timestamp: now.toISOString(),
  });
}
