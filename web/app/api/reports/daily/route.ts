// GET /api/reports/daily?days=30
// Resumen por día (últimos N días, default 30). Cuenta pedidos pagados
// agrupados por paid_at::date. is_test=false.
import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauth" }, { status: 401 });
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "no tenant" }, { status: 404 });

  const url = new URL(req.url);
  const daysRaw = Number(url.searchParams.get("days") ?? "30");
  const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(Math.floor(daysRaw), 180) : 30;
  const since = new Date(Date.now() - days * 86_400_000);

  // Fix Mario 2026-04-26: agrupar por día EN TZ TENANT, no UTC. Los bordes
  // de día quedaban desplazados 1-2h y los pedidos de la noche aparecían
  // en el día siguiente. Tenant en Atlantic/Canary por default.
  const tenantTz = bundle.tenant.timezone || "Atlantic/Canary";
  const tzLit = sql.raw(`'${tenantTz.replace(/'/g, "")}'`);

  const rows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${orders.paidAt} AT TIME ZONE ${tzLit}), 'YYYY-MM-DD')`,
      count: sql<number>`count(*)::int`,
      total: sql<number>`coalesce(sum(${orders.totalCents}), 0)::int`,
      avg: sql<number>`coalesce(avg(${orders.totalCents}), 0)::int`,
    })
    .from(orders)
    .where(and(
      eq(orders.tenantId, bundle.tenant.id),
      eq(orders.isTest, false),
      sql`${orders.status} != 'canceled'`,
      isNotNull(orders.paidAt),
      gte(orders.paidAt, since),
    ))
    .groupBy(sql`date_trunc('day', ${orders.paidAt} AT TIME ZONE ${tzLit})`)
    .orderBy(sql`date_trunc('day', ${orders.paidAt} AT TIME ZONE ${tzLit}) desc`);

  const grandTotal = rows.reduce((a, r) => a + r.total, 0);
  const grandCount = rows.reduce((a, r) => a + r.count, 0);

  return NextResponse.json({
    days,
    since: since.toISOString(),
    rows,
    totals: {
      count: grandCount,
      total: grandTotal,
      avg: grandCount > 0 ? Math.round(grandTotal / grandCount) : 0,
    },
  });
}
