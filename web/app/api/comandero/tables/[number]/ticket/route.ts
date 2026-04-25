// web/app/api/comandero/tables/[number]/ticket/route.ts
//
// GET — Devuelve la "cuenta" de la mesa: TODAS las orders abiertas dine_in
// + sus líneas + totales agregados. Usado por el POSView del comandero
// para mostrar la cuenta completa antes de aplicar descuento/propina/cobrar.

import { NextResponse } from "next/server";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { orderItems, orders, restaurantTables } from "@/lib/db/schema";
import { getComanderoActor } from "@/lib/employees/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPEN_STATUSES = [
  "pending_kitchen_review",
  "pending",
  "preparing",
  "ready",
  "served",
];

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ number: string }> },
) {
  const actor = await getComanderoActor();
  if (!actor) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const { number: tableNumber } = await params;
  if (!/^[A-Za-z0-9\-]{1,8}$/.test(tableNumber)) {
    return NextResponse.json({ error: "bad_table_number" }, { status: 400 });
  }

  const [tableRow] = await db
    .select({ id: restaurantTables.id })
    .from(restaurantTables)
    .where(
      and(
        eq(restaurantTables.tenantId, actor.tenantId),
        eq(restaurantTables.number, tableNumber),
      ),
    )
    .limit(1);
  if (!tableRow) return NextResponse.json({ error: "table_not_found" }, { status: 404 });

  const openOrders = await db
    .select({
      id: orders.id,
      status: orders.status,
      subtotalCents: orders.subtotalCents,
      taxCents: orders.taxCents,
      totalCents: orders.totalCents,
      tipCents: orders.tipCents,
      discountCents: orders.discountCents,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .where(
      and(
        eq(orders.tenantId, actor.tenantId),
        eq(orders.tableNumber, tableNumber),
        eq(orders.orderType, "dine_in"),
        ne(orders.status, "paid"),
        inArray(orders.status, OPEN_STATUSES),
      ),
    )
    .orderBy(asc(orders.createdAt));

  if (openOrders.length === 0) {
    return NextResponse.json({
      tableNumber,
      orders: [],
      lines: [],
      totals: { subtotal: 0, tax: 0, total: 0, discount: 0, tip: 0, finalToPay: 0 },
    });
  }

  const orderIds = openOrders.map((o) => o.id);
  const lines = await db
    .select({
      orderId: orderItems.orderId,
      name: orderItems.name,
      quantity: orderItems.quantity,
      unitPriceCents: orderItems.unitPriceCents,
      lineTotalCents: orderItems.lineTotalCents,
      modifiersJson: orderItems.modifiersJson,
      notes: orderItems.notes,
    })
    .from(orderItems)
    .where(inArray(orderItems.orderId, orderIds));

  const subtotal = openOrders.reduce((s, o) => s + o.subtotalCents, 0);
  const tax = openOrders.reduce((s, o) => s + o.taxCents, 0);
  const total = openOrders.reduce((s, o) => s + o.totalCents, 0);
  const tip = openOrders.reduce((s, o) => s + (o.tipCents ?? 0), 0);
  const discount = openOrders.reduce((s, o) => s + (o.discountCents ?? 0), 0);
  const finalToPay = total - discount + tip;

  return NextResponse.json({
    tableNumber,
    orders: openOrders,
    lines,
    totals: { subtotal, tax, total, discount, tip, finalToPay: Math.max(0, finalToPay) },
  });
}
