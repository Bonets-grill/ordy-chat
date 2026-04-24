// GET /api/reports/shifts/[id]
// Detalle de un turno: datos del shift + resumen de pedidos + top items.
import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { menuItems, orderItems, orders, shifts } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauth" }, { status: 401 });
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "no tenant" }, { status: 404 });

  const { id } = await ctx.params;

  const [shift] = await db
    .select()
    .from(shifts)
    .where(and(eq(shifts.id, id), eq(shifts.tenantId, bundle.tenant.id)))
    .limit(1);
  if (!shift) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Mig 039: sumamos totales y desglose por método en una sola pasada.
  // cash+NULL = caja; card/transfer/other = liquidan por fuera.
  const [summary] = await db
    .select({
      count: sql<number>`count(*)::int`,
      paidCount: sql<number>`count(*) FILTER (WHERE ${orders.paidAt} IS NOT NULL)::int`,
      total: sql<number>`coalesce(sum(${orders.totalCents}), 0)::int`,
      paidTotal: sql<number>`coalesce(sum(${orders.totalCents}) FILTER (WHERE ${orders.paidAt} IS NOT NULL), 0)::int`,
      avgTicket: sql<number>`coalesce(avg(${orders.totalCents}) FILTER (WHERE ${orders.paidAt} IS NOT NULL), 0)::int`,
      cashPaid: sql<number>`coalesce(sum(${orders.totalCents}) FILTER (WHERE ${orders.paidAt} IS NOT NULL AND (${orders.paymentMethod} = 'cash' OR ${orders.paymentMethod} IS NULL)), 0)::int`,
      cardPaid: sql<number>`coalesce(sum(${orders.totalCents}) FILTER (WHERE ${orders.paidAt} IS NOT NULL AND ${orders.paymentMethod} = 'card'), 0)::int`,
      transferPaid: sql<number>`coalesce(sum(${orders.totalCents}) FILTER (WHERE ${orders.paidAt} IS NOT NULL AND ${orders.paymentMethod} = 'transfer'), 0)::int`,
      otherPaid: sql<number>`coalesce(sum(${orders.totalCents}) FILTER (WHERE ${orders.paidAt} IS NOT NULL AND ${orders.paymentMethod} = 'other'), 0)::int`,
    })
    .from(orders)
    .where(and(eq(orders.shiftId, shift.id), eq(orders.isTest, false)));

  // Top 10 items vendidos en el turno (join order_items → menu_items opcional).
  const topItems = await db
    .select({
      name: orderItems.name,
      quantity: sql<number>`sum(${orderItems.quantity})::int`,
      revenueCents: sql<number>`coalesce(sum(${orderItems.lineTotalCents}), 0)::int`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(eq(orders.shiftId, shift.id), eq(orders.isTest, false)))
    .groupBy(orderItems.name)
    .orderBy(sql`sum(${orderItems.quantity}) DESC`)
    .limit(10);

  // Desglose horario.
  const hourly = await db
    .select({
      hour: sql<number>`extract(hour from ${orders.createdAt})::int`,
      count: sql<number>`count(*)::int`,
      total: sql<number>`coalesce(sum(${orders.totalCents}), 0)::int`,
    })
    .from(orders)
    .where(and(eq(orders.shiftId, shift.id), eq(orders.isTest, false)))
    .groupBy(sql`extract(hour from ${orders.createdAt})`)
    .orderBy(sql`extract(hour from ${orders.createdAt})`);

  // Mig 039: el esperado en caja es opening + cash (no paidTotal). Antes
  // usábamos paidTotal → falso positivo: un turno con 1000€ tarjeta y 0€
  // efectivo pedía al admin cuadrar a 1000€ que nunca pasaron por caja.
  const cashPaid = summary?.cashPaid ?? 0;
  const expected = shift.openingCashCents + cashPaid;
  const counted = shift.countedCashCents;
  const diff = counted === null || counted === undefined ? null : counted - expected;

  // Silenciar menuItems si no se usa (mantenemos import para posibles enrichments futuros).
  void menuItems;

  const byMethod = {
    cashCents: cashPaid,
    cardCents: summary?.cardPaid ?? 0,
    transferCents: summary?.transferPaid ?? 0,
    otherCents: summary?.otherPaid ?? 0,
    totalCents: summary?.paidTotal ?? 0,
  };

  return NextResponse.json({
    shift,
    summary: {
      count: summary?.count ?? 0,
      paidCount: summary?.paidCount ?? 0,
      total: summary?.total ?? 0,
      paidTotal: summary?.paidTotal ?? 0,
      avgTicket: summary?.avgTicket ?? 0,
      byMethod,
    },
    cash: {
      openingCashCents: shift.openingCashCents,
      // `paidCents` mantiene el nombre pero ahora es SOLO cash+NULL (no total).
      paidCents: cashPaid,
      expectedCashCents: expected,
      countedCashCents: counted,
      diffCents: diff,
      // Mig 039: desglose completo para render en UI.
      byMethod,
    },
    topItems,
    hourly,
  });
}
