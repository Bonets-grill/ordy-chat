// GET /api/reports/hourly?period=today|7d|30d
// Mig 041: agregado por hora del día (0-23) → pedidos pagados.
// Sirve al chart "horas pico" en /dashboard/ventas/horas.
//
// Multi-tenant: filtra por bundle.tenant.id. is_test=false (no contamos
// pedidos del playground en analítica).
import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
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
  // Aceptamos solo today|7d|30d aquí — "shift:UUID" no aplica a horas pico
  // (un solo turno son pocas horas, los reportes por turno ya existen en
  // /api/reports/shifts/[id]).
  const period = parsePeriod(url.searchParams.get("period")) ?? {
    kind: "ndays" as const,
    days: 30 as const,
    since: new Date(Date.now() - 30 * 86_400_000),
  };
  if (period.kind === "shift") {
    return NextResponse.json({ error: "period_not_supported" }, { status: 400 });
  }

  const rows = await db
    .select({
      hour: sql<number>`extract(hour from ${orders.paidAt})::int`,
      count: sql<number>`count(*)::int`,
      totalCents: sql<number>`coalesce(sum(${orders.totalCents}), 0)::int`,
    })
    .from(orders)
    .where(and(
      eq(orders.tenantId, bundle.tenant.id),
      eq(orders.isTest, false),
      isNotNull(orders.paidAt),
      gte(orders.paidAt, period.since),
    ))
    .groupBy(sql`extract(hour from ${orders.paidAt})`)
    .orderBy(sql`extract(hour from ${orders.paidAt})`);

  // Densificar 0..23 con ceros para que el chart pinte todas las horas
  // aunque algunas estén vacías. Útil para que el copy "no vendiste nada
  // entre 04:00 y 06:00" sea visible.
  const map = new Map(rows.map((r) => [r.hour, r]));
  const dense = Array.from({ length: 24 }, (_, h) => {
    const found = map.get(h);
    return {
      hour: h,
      count: found?.count ?? 0,
      totalCents: found?.totalCents ?? 0,
    };
  });

  return NextResponse.json({
    period: period.kind,
    since: period.since.toISOString(),
    rows: dense,
  });
}
