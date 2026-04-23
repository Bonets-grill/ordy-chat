// web/app/api/cron/sessions-cleanup/route.ts — Vercel Cron cada 5 min.
// Fase 6 del plan de sesión de mesa.
//
// Cierra definitivamente las sesiones que llevan ≥5 min en 'paid':
//   - Transiciona 'paid' → 'closed' con closed_at=now().
//   - Libera la (tenant, table_number) para abrir una nueva sesión
//     limpia cuando llegue el próximo comensal (la partial unique
//     deja de aplicar al no estar 'paid' ni ahora).
//
// El cron es idempotente: un UPDATE con WHERE status='paid' AND paid_at
// < now() - 5min no toca sesiones recientes ni ya cerradas.

import { and, eq, lt, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { tableSessions } from "@/lib/db/schema";
import { validateCronAuth } from "@/lib/cron";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const unauthorized = validateCronAuth(req);
  if (unauthorized) return unauthorized;

  const cutoff = new Date(Date.now() - 5 * 60_000);
  const now = new Date();

  const closed = await db
    .update(tableSessions)
    .set({ status: "closed", closedAt: now, updatedAt: now })
    .where(
      and(
        eq(tableSessions.status, "paid"),
        lt(tableSessions.paidAt, cutoff),
      ),
    )
    .returning({ id: tableSessions.id });

  return NextResponse.json({
    ok: true,
    closed: closed.length,
    cutoff: cutoff.toISOString(),
  });
}
