// web/app/api/comandero/tables/[number]/split/route.ts
//
// Mig 055 — Split bill (dividir cuenta).
//
// GET   → lista subcuentas pendientes/pagadas + balance restante de la mesa.
// POST  → crea una subcuenta pendiente (item|amount|equal). Si splitKind='item'
//         envía itemsJson + monto computado. Si 'amount' o 'equal' solo amount.
// PATCH → /[paymentId]/pay marca subcuenta como pagada y, si la suma cubre
//         el total ajustado, cierra todos los orders abiertos de la mesa.

import { NextResponse } from "next/server";
import { z } from "zod";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  orderItems,
  orders,
  restaurantTables,
  tableSessions,
  tableSplitPayments,
} from "@/lib/db/schema";
import { ORDER_PAYMENT_METHODS } from "@/lib/payment-methods";
import { getComanderoActor } from "@/lib/employees/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ItemRefSchema = z.object({
  orderId: z.string().uuid(),
  orderItemId: z.string().uuid().optional(),
  name: z.string().min(1),
  quantity: z.number().int().min(1),
  unitPriceCents: z.number().int().min(0),
});

const CreateBody = z.object({
  splitKind: z.enum(["item", "amount", "equal"]),
  amountCents: z.number().int().min(0).max(100_000_000),
  items: z.array(ItemRefSchema).max(100).optional(),
  paymentMethod: z.enum(ORDER_PAYMENT_METHODS),
  tipCents: z.number().int().min(0).max(100_000_000).optional(),
  discountCents: z.number().int().min(0).max(100_000_000).optional(),
  label: z.string().max(80).optional(),
});

const OPEN_STATUSES = [
  "pending_kitchen_review",
  "pending",
  "preparing",
  "ready",
  "served",
];

async function ensureTable(actor: { tenantId: string }, tableNumber: string) {
  if (!/^[A-Za-z0-9\-]{1,8}$/.test(tableNumber)) return null;
  const [t] = await db
    .select({ id: restaurantTables.id, active: restaurantTables.active })
    .from(restaurantTables)
    .where(
      and(
        eq(restaurantTables.tenantId, actor.tenantId),
        eq(restaurantTables.number, tableNumber),
      ),
    )
    .limit(1);
  return t && t.active ? t : null;
}

async function getActiveSession(tenantId: string, tableNumber: string) {
  const [s] = await db
    .select({ id: tableSessions.id })
    .from(tableSessions)
    .where(
      and(
        eq(tableSessions.tenantId, tenantId),
        eq(tableSessions.tableNumber, tableNumber),
        ne(tableSessions.status, "closed"),
        ne(tableSessions.status, "paid"),
      ),
    )
    .orderBy(asc(tableSessions.createdAt))
    .limit(1);
  return s ?? null;
}

async function computeTableTotals(tenantId: string, tableNumber: string) {
  const openOrders = await db
    .select({
      id: orders.id,
      totalCents: orders.totalCents,
      tipCents: orders.tipCents,
      discountCents: orders.discountCents,
    })
    .from(orders)
    .where(
      and(
        eq(orders.tenantId, tenantId),
        eq(orders.tableNumber, tableNumber),
        eq(orders.orderType, "dine_in"),
        ne(orders.status, "paid"),
        inArray(orders.status, OPEN_STATUSES),
      ),
    );
  const total = openOrders.reduce((s, o) => s + o.totalCents, 0);
  const tip = openOrders.reduce((s, o) => s + (o.tipCents ?? 0), 0);
  const discount = openOrders.reduce((s, o) => s + (o.discountCents ?? 0), 0);
  return { openOrders, total, tip, discount, finalToPay: Math.max(0, total - discount + tip) };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ number: string }> },
) {
  const actor = await getComanderoActor();
  if (!actor) return NextResponse.json({ error: "unauth" }, { status: 401 });
  const { number: tableNumber } = await params;
  const t = await ensureTable(actor, tableNumber);
  if (!t) return NextResponse.json({ error: "table_not_found" }, { status: 404 });

  const payments = await db
    .select()
    .from(tableSplitPayments)
    .where(
      and(
        eq(tableSplitPayments.tenantId, actor.tenantId),
        eq(tableSplitPayments.tableNumber, tableNumber),
        ne(tableSplitPayments.status, "voided"),
      ),
    )
    .orderBy(asc(tableSplitPayments.createdAt));

  const totals = await computeTableTotals(actor.tenantId, tableNumber);
  const paidSoFar = payments
    .filter((p) => p.status === "paid")
    .reduce((s, p) => s + p.amountCents, 0);
  const pendingAmount = payments
    .filter((p) => p.status === "pending")
    .reduce((s, p) => s + p.amountCents, 0);
  const remaining = Math.max(0, totals.finalToPay - paidSoFar - pendingAmount);

  return NextResponse.json({
    tableNumber,
    payments,
    totals: {
      ...totals,
      paidSoFar,
      pendingAmount,
      remaining,
    },
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ number: string }> },
) {
  const actor = await getComanderoActor();
  if (!actor) return NextResponse.json({ error: "unauth" }, { status: 401 });
  const { number: tableNumber } = await params;
  const t = await ensureTable(actor, tableNumber);
  if (!t) return NextResponse.json({ error: "table_not_found" }, { status: 404 });

  const parsed = CreateBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_input", issues: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  // Para split por items, validar que pertenecen a la mesa actual.
  if (data.splitKind === "item") {
    const orderIds = Array.from(new Set((data.items ?? []).map((i) => i.orderId)));
    if (orderIds.length === 0) {
      return NextResponse.json({ error: "items_required_for_item_split" }, { status: 400 });
    }
    const ownership = await db
      .select({ id: orders.id })
      .from(orders)
      .where(
        and(
          eq(orders.tenantId, actor.tenantId),
          eq(orders.tableNumber, tableNumber),
          inArray(orders.id, orderIds),
        ),
      );
    if (ownership.length !== orderIds.length) {
      return NextResponse.json({ error: "items_not_on_table" }, { status: 400 });
    }
  }

  const session = await getActiveSession(actor.tenantId, tableNumber);

  const [created] = await db
    .insert(tableSplitPayments)
    .values({
      tenantId: actor.tenantId,
      sessionId: session?.id ?? null,
      tableNumber,
      splitKind: data.splitKind,
      itemsJson: data.items ?? [],
      amountCents: data.amountCents,
      tipCents: data.tipCents ?? 0,
      discountCents: data.discountCents ?? 0,
      paymentMethod: data.paymentMethod,
      status: "pending",
      label: data.label ?? null,
    })
    .returning();

  return NextResponse.json({ payment: created }, { status: 201 });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ number: string }> },
) {
  // DELETE ?id=<paymentId> → marca como voided. Cleanup soft, no borra.
  const actor = await getComanderoActor();
  if (!actor) return NextResponse.json({ error: "unauth" }, { status: 401 });
  const { number: tableNumber } = await params;
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id_required" }, { status: 400 });

  const updated = await db
    .update(tableSplitPayments)
    .set({ status: "voided", updatedAt: new Date() })
    .where(
      and(
        eq(tableSplitPayments.id, id),
        eq(tableSplitPayments.tenantId, actor.tenantId),
        eq(tableSplitPayments.tableNumber, tableNumber),
        eq(tableSplitPayments.status, "pending"),
      ),
    )
    .returning({ id: tableSplitPayments.id });

  if (updated.length === 0) {
    return NextResponse.json({ error: "not_found_or_already_paid" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

// Re-export para los tests:
export const _internal = {
  computeTableTotals,
  getActiveSession,
  ensureTable,
  CreateBody,
  ItemRefSchema,
  OPEN_STATUSES,
  orderItems,
};
