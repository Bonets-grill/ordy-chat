// GET /api/reports/tips?period=today|7d|30d|shift:UUID
// Mig 041: reporte de propinas. Total + num pedidos con propina + propina
// media + % sobre revenue. Si period es Nd, breakdown por día. Si shift,
// breakdown por turno (1 entrada).
//
// Multi-tenant: filtra por bundle.tenant.id. is_test=false. Para shift
// validamos ownership antes de devolver datos.
import { and, eq, gte, gt, isNotNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { orders, shifts } from "@/lib/db/schema";
import { parsePeriodWithDefault } from "@/lib/reports/period";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauth" }, { status: 401 });
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "no tenant" }, { status: 404 });

  const url = new URL(req.url);
  const period = parsePeriodWithDefault(url.searchParams.get("period"));

  // Conds compartidas. Para shift validamos ownership primero.
  const baseConds = [
    eq(orders.tenantId, bundle.tenant.id),
    eq(orders.isTest, false),
    isNotNull(orders.paidAt),
  ];

  if (period.kind === "shift") {
    const [s] = await db
      .select({ id: shifts.id })
      .from(shifts)
      .where(and(eq(shifts.id, period.shiftId), eq(shifts.tenantId, bundle.tenant.id)))
      .limit(1);
    if (!s) return NextResponse.json({ error: "shift_not_found" }, { status: 404 });
    baseConds.push(eq(orders.shiftId, period.shiftId));
  } else {
    baseConds.push(gte(orders.paidAt, period.since));
  }

  // Total + num pedidos con propina + revenue del periodo (para tipPctOfRevenue).
  // ordersWithTip cuenta solo pedidos con tip > 0.
  const [totalRow] = await db
    .select({
      tipCents: sql<number>`coalesce(sum(${orders.tipCents}), 0)::int`,
      ordersWithTip: sql<number>`count(*) FILTER (WHERE ${orders.tipCents} > 0)::int`,
      revenueCents: sql<number>`coalesce(sum(${orders.totalCents}), 0)::int`,
    })
    .from(orders)
    .where(and(...baseConds));

  const tipCents = totalRow?.tipCents ?? 0;
  const ordersWithTip = totalRow?.ordersWithTip ?? 0;
  const revenueCents = totalRow?.revenueCents ?? 0;
  const avgTipCents = ordersWithTip > 0 ? Math.round(tipCents / ordersWithTip) : 0;
  // % de propinas sobre el total cobrado del período. Si no hubo revenue, 0.
  const tipPctOfRevenue = revenueCents > 0 ? (tipCents / revenueCents) * 100 : 0;

  const total = {
    tipCents,
    ordersWithTip,
    avgTipCents,
    tipPctOfRevenue,
  };

  // Breakdown por día solo cuando es período de Nd. Para shift devolvemos
  // un único byShift (informativo) — el total ya cubre el caso.
  if (period.kind === "ndays" || period.kind === "today") {
    // Agrupa por día solo pedidos con propina (gt 0). Si no hay propinas,
    // byDay queda vacío — el frontend pinta empty state.
    const byDay = await db
      .select({
        day: sql<string>`to_char(date_trunc('day', ${orders.paidAt}), 'YYYY-MM-DD')`,
        tipCents: sql<number>`coalesce(sum(${orders.tipCents}), 0)::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(orders)
      .where(and(...baseConds, gt(orders.tipCents, 0)))
      .groupBy(sql`date_trunc('day', ${orders.paidAt})`)
      .orderBy(sql`date_trunc('day', ${orders.paidAt}) desc`);

    return NextResponse.json({
      period: period.kind,
      total,
      byDay,
    });
  }

  // Shift: breakdown por turno (1 entrada).
  return NextResponse.json({
    period: "shift",
    total,
    byShift: {
      shiftId: period.shiftId,
      tipCents,
      count: ordersWithTip,
    },
  });
}
