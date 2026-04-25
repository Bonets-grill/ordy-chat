// web/app/api/comandero/tables/[number]/close/route.ts
//
// POST — Cierra la mesa: marca todas las orders dine_in abiertas de esa
// mesa como `paid` con el método indicado. Tras esto las orders salen de
// OPEN_STATUSES y la mesa pasa a estado free en /api/comandero/tables.
// Reusa markOrderPaidManual (idempotente, audit-safe).

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, restaurantTables } from "@/lib/db/schema";
import { auth } from "@/lib/auth";
import { requireTenant } from "@/lib/tenant";
import { markOrderPaidManual } from "@/lib/orders";
import { ORDER_PAYMENT_METHODS } from "@/lib/payment-methods";
import { limitByUserId } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BODY = z.object({
  paymentMethod: z.enum(ORDER_PAYMENT_METHODS).default("cash"),
});

const OPEN_STATUSES = [
  "pending_kitchen_review",
  "pending",
  "preparing",
  "ready",
  "served",
];

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ number: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "tenant_not_found" }, { status: 401 });

  const rate = await limitByUserId(session.user.id, "comandero_close_table", 60, "1 h");
  if (!rate.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const { number: tableNumber } = await params;
  if (!/^[A-Za-z0-9\-]{1,8}$/.test(tableNumber)) {
    return NextResponse.json({ error: "bad_table_number" }, { status: 400 });
  }

  const body = BODY.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: "bad_input" }, { status: 400 });
  }

  // Mesa debe existir + estar activa.
  const [tableRow] = await db
    .select({ id: restaurantTables.id, active: restaurantTables.active })
    .from(restaurantTables)
    .where(
      and(
        eq(restaurantTables.tenantId, bundle.tenant.id),
        eq(restaurantTables.number, tableNumber),
      ),
    )
    .limit(1);
  if (!tableRow || !tableRow.active) {
    return NextResponse.json({ error: "table_not_found" }, { status: 404 });
  }

  // Orders abiertas de esa mesa.
  const open = await db
    .select({ id: orders.id, totalCents: orders.totalCents })
    .from(orders)
    .where(
      and(
        eq(orders.tenantId, bundle.tenant.id),
        eq(orders.tableNumber, tableNumber),
        eq(orders.orderType, "dine_in"),
        eq(orders.isTest, false),
        ne(orders.status, "paid"),
        inArray(orders.status, OPEN_STATUSES),
      ),
    );

  let closedCount = 0;
  let closedTotalCents = 0;
  for (const o of open) {
    const updated = await markOrderPaidManual(
      o.id,
      bundle.tenant.id,
      body.data.paymentMethod,
    );
    if (updated) {
      closedCount += 1;
      closedTotalCents += o.totalCents;
    }
  }

  return NextResponse.json({
    ok: true,
    closedCount,
    closedTotalCents,
    paymentMethod: body.data.paymentMethod,
  });
}
