// GET /api/shifts/current
// Turno abierto actual + resumen vivo (num pedidos, total cobrado, ticket medio).
import { and, eq, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { orders, shifts } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauth" }, { status: 401 });
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "no tenant" }, { status: 404 });

  const [shift] = await db
    .select()
    .from(shifts)
    .where(and(eq(shifts.tenantId, bundle.tenant.id), isNull(shifts.closedAt)))
    .limit(1);

  if (!shift) return NextResponse.json({ shift: null });

  // Resumen vivo: pedidos de este turno (no-test).
  const [summary] = await db
    .select({
      count: sql<number>`count(*)::int`,
      paidCount: sql<number>`count(*) FILTER (WHERE ${orders.paidAt} IS NOT NULL)::int`,
      total: sql<number>`coalesce(sum(${orders.totalCents}), 0)::int`,
      paidTotal: sql<number>`coalesce(sum(${orders.totalCents}) FILTER (WHERE ${orders.paidAt} IS NOT NULL), 0)::int`,
    })
    .from(orders)
    .where(and(eq(orders.shiftId, shift.id), eq(orders.isTest, false)));

  return NextResponse.json({
    shift,
    summary: summary ?? { count: 0, paidCount: 0, total: 0, paidTotal: 0 },
  });
}
