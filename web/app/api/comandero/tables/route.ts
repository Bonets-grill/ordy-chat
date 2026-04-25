// web/app/api/comandero/tables/route.ts
//
// GET — mesas activas del tenant + estado actual derivado de orders abiertas.
// Estados: free | occupied. El comandero pinta el grid con estos badges.

import { NextResponse } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, restaurantTables } from "@/lib/db/schema";
import { getComanderoActor } from "@/lib/employees/scope";

export const dynamic = "force-dynamic";

const OPEN_STATUSES = [
  "pending_kitchen_review",
  "pending",
  "preparing",
  "ready",
  "served",
];

export async function GET() {
  const actor = await getComanderoActor();
  if (!actor) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const tables = await db
    .select()
    .from(restaurantTables)
    .where(
      and(
        eq(restaurantTables.tenantId, actor.tenantId),
        eq(restaurantTables.active, true),
      ),
    )
    .orderBy(restaurantTables.sortOrder, restaurantTables.number);

  const activity = await db
    .select({
      tableNumber: orders.tableNumber,
      openCount: sql<number>`cast(count(*) as int)`,
      totalCents: sql<number>`coalesce(sum(${orders.totalCents}), 0)::int`,
    })
    .from(orders)
    .where(
      and(
        eq(orders.tenantId, actor.tenantId),
        eq(orders.orderType, "dine_in"),
        eq(orders.isTest, false),
        inArray(orders.status, OPEN_STATUSES),
      ),
    )
    .groupBy(orders.tableNumber);

  const byNumber = new Map(activity.map((a) => [a.tableNumber, a]));

  const enriched = tables.map((t) => {
    const a = byNumber.get(t.number);
    const openCount = a?.openCount ?? 0;
    return {
      id: t.id,
      number: t.number,
      zone: t.zone,
      seats: t.seats,
      shape: t.shape,
      state: openCount > 0 ? "occupied" : "free",
      openOrdersCount: openCount,
      openTotalCents: a?.totalCents ?? 0,
    };
  });

  return NextResponse.json({ tables: enriched });
}
