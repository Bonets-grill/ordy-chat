// GET /api/reports/pareto?period=today|7d|30d
// Mig 041: análisis 80/20 de productos. Cuántos productos generan el 80%
// del revenue + qué % del catálogo representan.
//
// La query SQL agrupa todo el catálogo en el período (sin LIMIT — el corte
// 80% requiere conocer la cola entera). El cálculo del 80% acumulado vive
// en lib/reports/pareto.ts (pure, testeado en reports-pareto.test.ts).
import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { orderItems, orders } from "@/lib/db/schema";
import { computePareto } from "@/lib/reports/pareto";
import { parsePeriod } from "@/lib/reports/period";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauth" }, { status: 401 });
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "no tenant" }, { status: 404 });

  const url = new URL(req.url);
  const period = parsePeriod(url.searchParams.get("period")) ?? {
    kind: "ndays" as const,
    days: 30 as const,
    since: new Date(Date.now() - 30 * 86_400_000),
  };
  if (period.kind === "shift") {
    return NextResponse.json({ error: "period_not_supported" }, { status: 400 });
  }

  const items = await db
    .select({
      name: orderItems.name,
      revenueCents: sql<number>`coalesce(sum(${orderItems.lineTotalCents}), 0)::int`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(
      eq(orders.tenantId, bundle.tenant.id),
      eq(orders.isTest, false),
      isNotNull(orders.paidAt),
      gte(orders.paidAt, period.since),
    ))
    .groupBy(orderItems.name)
    .orderBy(sql`sum(${orderItems.lineTotalCents}) DESC`);

  const result = computePareto(items);

  return NextResponse.json({
    period: period.kind,
    rows: result.rows,
    totalRevenueCents: result.totalRevenueCents,
    paretoCount: result.paretoCount,
    paretoSharePct: result.paretoSharePct,
  });
}
