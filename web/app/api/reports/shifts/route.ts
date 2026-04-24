// GET /api/reports/shifts?limit=50
// Lista de turnos cerrados (histórico) + totales.
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { orders, shifts } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauth" }, { status: 401 });
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "no tenant" }, { status: 404 });

  const url = new URL(req.url);
  const limitRaw = Number(url.searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 200) : 50;

  // LEFT JOIN agregado por turno.
  const rows = await db
    .select({
      id: shifts.id,
      openedAt: shifts.openedAt,
      closedAt: shifts.closedAt,
      openedBy: shifts.openedBy,
      closedBy: shifts.closedBy,
      openingCashCents: shifts.openingCashCents,
      countedCashCents: shifts.countedCashCents,
      notes: shifts.notes,
      orderCount: sql<number>`(
        SELECT count(*)::int FROM ${orders} o
        WHERE o.shift_id = ${shifts.id} AND o.is_test = false
      )`,
      paidCents: sql<number>`(
        SELECT coalesce(sum(o.total_cents), 0)::int FROM ${orders} o
        WHERE o.shift_id = ${shifts.id} AND o.is_test = false AND o.paid_at IS NOT NULL
      )`,
    })
    .from(shifts)
    .where(and(eq(shifts.tenantId, bundle.tenant.id), isNotNull(shifts.closedAt)))
    .orderBy(desc(shifts.openedAt))
    .limit(limit);

  return NextResponse.json({ rows });
}
