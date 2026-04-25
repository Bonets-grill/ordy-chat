// web/app/api/reports/waiters/route.ts
//
// GET /api/reports/waiters?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Reportes POS por mesero. Filtra orders del tenant que tienen
// metadata->>'created_by_waiter_id' (i.e. fueron creadas desde el comandero
// por un mesero humano logueado, no por el bot WA ni el web público).
//
// Devuelve agregados por waiter_id: pedidos, ítems, total cobrado.

import { NextResponse, type NextRequest } from "next/server";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, users } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";

export const dynamic = "force-dynamic";

function parseISODate(s: string | null): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function GET(req: NextRequest) {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const u = new URL(req.url);
  const from = parseISODate(u.searchParams.get("from")) ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const toRaw = parseISODate(u.searchParams.get("to"));
  // Si llega `to`, lo extendemos +1 día para hacer rango [from, to+1) inclusive.
  const to = toRaw ? new Date(toRaw.getTime() + 24 * 60 * 60 * 1000) : new Date();

  const rows = await db
    .select({
      waiterId: sql<string>`(${orders.metadata} ->> 'created_by_waiter_id')`,
      orderCount: sql<number>`cast(count(*) as int)`,
      totalCents: sql<number>`coalesce(sum(${orders.totalCents}), 0)::int`,
      paidTotalCents: sql<number>`coalesce(sum(${orders.totalCents}) filter (where ${orders.status} = 'paid'), 0)::int`,
    })
    .from(orders)
    .where(
      and(
        eq(orders.tenantId, bundle.tenant.id),
        eq(orders.isTest, false),
        gte(orders.createdAt, from),
        lt(orders.createdAt, to),
        sql`${orders.metadata} ? 'created_by_waiter_id'`,
      ),
    )
    .groupBy(sql`${orders.metadata} ->> 'created_by_waiter_id'`);

  // Resolver email/name del waiter para display.
  const waiterIds = rows.map((r) => r.waiterId).filter((id): id is string => Boolean(id));
  const waiterMap = new Map<string, { email: string; name: string | null }>();
  if (waiterIds.length > 0) {
    const userRows = await db
      .select({ id: users.id, email: users.email, name: users.name })
      .from(users);
    for (const u of userRows) {
      if (waiterIds.includes(u.id)) {
        waiterMap.set(u.id, { email: u.email, name: u.name });
      }
    }
  }

  const enriched = rows
    .map((r) => ({
      waiterId: r.waiterId,
      waiter: waiterMap.get(r.waiterId) ?? { email: "?", name: null },
      orderCount: r.orderCount,
      totalCents: r.totalCents,
      paidTotalCents: r.paidTotalCents,
    }))
    .sort((a, b) => b.paidTotalCents - a.paidTotalCents);

  return NextResponse.json({
    from: from.toISOString().slice(0, 10),
    to: new Date(to.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    waiters: enriched,
    totals: {
      orderCount: enriched.reduce((s, w) => s + w.orderCount, 0),
      totalCents: enriched.reduce((s, w) => s + w.totalCents, 0),
      paidTotalCents: enriched.reduce((s, w) => s + w.paidTotalCents, 0),
    },
  });
}
