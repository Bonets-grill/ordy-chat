// GET /api/reports/daily/export?days=30
// CSV con el desglose de ventas por día (últimos N días, default 30, cap 180).
// Sólo pedidos pagados is_test=false.
import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { centsToAmount, csvFilename, csvJoin } from "@/lib/csv";
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

  // Mismo shape que /api/reports/daily — diferencia: export añade avg ticket
  // y filtra por tenant del bundle (ownership).
  const rows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${orders.paidAt}), 'YYYY-MM-DD')`,
      count: sql<number>`count(*)::int`,
      total: sql<number>`coalesce(sum(${orders.totalCents}), 0)::int`,
      avg: sql<number>`coalesce(avg(${orders.totalCents}), 0)::int`,
    })
    .from(orders)
    .where(and(
      eq(orders.tenantId, bundle.tenant.id),
      eq(orders.isTest, false),
      isNotNull(orders.paidAt),
      gte(orders.paidAt, since),
    ))
    .groupBy(sql`date_trunc('day', ${orders.paidAt})`)
    .orderBy(sql`date_trunc('day', ${orders.paidAt}) desc`);

  const header = ["day", "orders_count", "total_cents", "avg_ticket_cents"] as const;
  const body = rows.map((r) => [
    r.day,
    String(r.count),
    centsToAmount(r.total),
    centsToAmount(r.avg),
  ]);

  const csv = csvJoin(header, body);
  const filename = csvFilename({
    base: "ventas-por-dia",
    tenantSlug: bundle.tenant.slug,
  });

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
