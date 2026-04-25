// web/app/api/comandero/tables/[number]/split/[paymentId]/pay/route.ts
//
// PATCH — Marca una subcuenta como pagada (split bill).
// Si la suma de subcuentas pagadas cubre el total ajustado de la mesa,
// cierra TODOS los orders dine_in abiertos via markOrderPaidManual.

import { NextResponse } from "next/server";
import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  orders,
  restaurantTables,
  tableSplitPayments,
} from "@/lib/db/schema";
import { markOrderPaidManual } from "@/lib/orders";
import { ORDER_PAYMENT_METHODS, type OrderPaymentMethod } from "@/lib/payment-methods";
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

export async function PATCH(
  _req: Request,
  { params }: { params: Promise<{ number: string; paymentId: string }> },
) {
  const actor = await getComanderoActor();
  if (!actor) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const { number: tableNumber, paymentId } = await params;
  if (!/^[A-Za-z0-9\-]{1,8}$/.test(tableNumber)) {
    return NextResponse.json({ error: "bad_table_number" }, { status: 400 });
  }

  // Mesa válida
  const [t] = await db
    .select({ id: restaurantTables.id })
    .from(restaurantTables)
    .where(
      and(
        eq(restaurantTables.tenantId, actor.tenantId),
        eq(restaurantTables.number, tableNumber),
      ),
    )
    .limit(1);
  if (!t) return NextResponse.json({ error: "table_not_found" }, { status: 404 });

  // Marca la subcuenta como pagada (idempotente: si ya está paid, no toca).
  const [paid] = await db
    .update(tableSplitPayments)
    .set({ status: "paid", paidAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(tableSplitPayments.id, paymentId),
        eq(tableSplitPayments.tenantId, actor.tenantId),
        eq(tableSplitPayments.tableNumber, tableNumber),
        eq(tableSplitPayments.status, "pending"),
      ),
    )
    .returning();
  if (!paid) {
    return NextResponse.json({ error: "not_found_or_already_paid" }, { status: 404 });
  }

  // Recalcular si la suma de pagados cubre el total — si sí, cerrar mesa.
  const allPayments = await db
    .select({ amountCents: tableSplitPayments.amountCents, status: tableSplitPayments.status })
    .from(tableSplitPayments)
    .where(
      and(
        eq(tableSplitPayments.tenantId, actor.tenantId),
        eq(tableSplitPayments.tableNumber, tableNumber),
        ne(tableSplitPayments.status, "voided"),
      ),
    );
  const paidSoFar = allPayments
    .filter((p) => p.status === "paid")
    .reduce((s, p) => s + p.amountCents, 0);

  const open = await db
    .select({ id: orders.id, totalCents: orders.totalCents, tipCents: orders.tipCents, discountCents: orders.discountCents })
    .from(orders)
    .where(
      and(
        eq(orders.tenantId, actor.tenantId),
        eq(orders.tableNumber, tableNumber),
        eq(orders.orderType, "dine_in"),
        ne(orders.status, "paid"),
        inArray(orders.status, OPEN_STATUSES),
      ),
    );
  const total = open.reduce((s, o) => s + o.totalCents, 0);
  const tip = open.reduce((s, o) => s + (o.tipCents ?? 0), 0);
  const discount = open.reduce((s, o) => s + (o.discountCents ?? 0), 0);
  const finalToPay = Math.max(0, total - discount + tip);

  let tableClosed = false;
  if (paidSoFar >= finalToPay && open.length > 0) {
    // Cast seguro: paid.paymentMethod ya validado por Zod en el POST
    // (CreateBody usa z.enum(ORDER_PAYMENT_METHODS)). DB CHECK no existe pero
    // confiamos en input layer.
    const method = (ORDER_PAYMENT_METHODS as readonly string[]).includes(paid.paymentMethod)
      ? (paid.paymentMethod as OrderPaymentMethod)
      : ("cash" as OrderPaymentMethod);
    for (const o of open) {
      await markOrderPaidManual(o.id, actor.tenantId, method);
    }
    tableClosed = true;
  }

  return NextResponse.json({
    payment: paid,
    paidSoFar,
    finalToPay,
    remaining: Math.max(0, finalToPay - paidSoFar),
    tableClosed,
  });
}
