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
  // Mig 039: byMethod desglose para el panel /dashboard/turno. cash+NULL
  // son los únicos que cuentan para "esperado en caja".
  const [summary] = await db
    .select({
      count: sql<number>`count(*)::int`,
      paidCount: sql<number>`count(*) FILTER (WHERE ${orders.paidAt} IS NOT NULL)::int`,
      total: sql<number>`coalesce(sum(${orders.totalCents}), 0)::int`,
      paidTotal: sql<number>`coalesce(sum(${orders.totalCents}) FILTER (WHERE ${orders.paidAt} IS NOT NULL), 0)::int`,
      cashPaid: sql<number>`coalesce(sum(${orders.totalCents}) FILTER (WHERE ${orders.paidAt} IS NOT NULL AND (${orders.paymentMethod} = 'cash' OR ${orders.paymentMethod} IS NULL)), 0)::int`,
      cardPaid: sql<number>`coalesce(sum(${orders.totalCents}) FILTER (WHERE ${orders.paidAt} IS NOT NULL AND ${orders.paymentMethod} = 'card'), 0)::int`,
      transferPaid: sql<number>`coalesce(sum(${orders.totalCents}) FILTER (WHERE ${orders.paidAt} IS NOT NULL AND ${orders.paymentMethod} = 'transfer'), 0)::int`,
      otherPaid: sql<number>`coalesce(sum(${orders.totalCents}) FILTER (WHERE ${orders.paidAt} IS NOT NULL AND ${orders.paymentMethod} = 'other'), 0)::int`,
    })
    .from(orders)
    .where(and(eq(orders.shiftId, shift.id), eq(orders.isTest, false)));

  const byMethod = {
    cashCents: summary?.cashPaid ?? 0,
    cardCents: summary?.cardPaid ?? 0,
    transferCents: summary?.transferPaid ?? 0,
    otherCents: summary?.otherPaid ?? 0,
  };

  return NextResponse.json({
    shift,
    summary: {
      count: summary?.count ?? 0,
      paidCount: summary?.paidCount ?? 0,
      total: summary?.total ?? 0,
      paidTotal: summary?.paidTotal ?? 0,
      byMethod,
    },
  });
}
