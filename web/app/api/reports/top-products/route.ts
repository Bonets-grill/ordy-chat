// GET /api/reports/top-products?period=today|7d|30d|shift:UUID&limit=20
// Mig 041: top productos por revenue + qty + % del total.
// Sirve al panel /dashboard/ventas/productos.
//
// Multi-tenant: filtra por bundle.tenant.id. is_test=false. Si period=shift:UUID
// validamos ownership del shift antes de devolver datos.
import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { orderItems, orders, shifts } from "@/lib/db/schema";
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
  const limitRaw = Number(url.searchParams.get("limit") ?? "20");
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 100) : 20;

  // Construimos las condiciones según el tipo de período. Para shift hacemos
  // primero un check de ownership (404 si el shift es de otro tenant) — sin
  // ese gate un atacante podría enumerar shifts ajenos por su id.
  const baseConds = [
    eq(orders.tenantId, bundle.tenant.id),
    eq(orders.isTest, false),
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
    baseConds.push(isNotNull(orders.paidAt));
    baseConds.push(gte(orders.paidAt, period.since));
  }

  const rows = await db
    .select({
      name: orderItems.name,
      quantity: sql<number>`sum(${orderItems.quantity})::int`,
      revenueCents: sql<number>`coalesce(sum(${orderItems.lineTotalCents}), 0)::int`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(...baseConds))
    .groupBy(orderItems.name)
    .orderBy(sql`sum(${orderItems.lineTotalCents}) DESC`)
    .limit(limit);

  const totalRevenueCents = rows.reduce((a, r) => a + r.revenueCents, 0);
  const enriched = rows.map((r) => ({
    name: r.name,
    quantity: r.quantity,
    revenueCents: r.revenueCents,
    sharePct: totalRevenueCents > 0 ? (r.revenueCents / totalRevenueCents) * 100 : 0,
  }));

  return NextResponse.json({
    period: period.kind,
    rows: enriched,
    totalRevenueCents,
  });
}
