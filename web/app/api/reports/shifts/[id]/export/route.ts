// GET /api/reports/shifts/[id]/export?format=csv
// CSV con el detalle de todos los pedidos (is_test=false) de un turno.
// El contable/asesor lo usa para conciliación y cierre fiscal.
import { and, asc, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { centsToAmount, csvEscape, csvFilename, csvJoin } from "@/lib/csv";
import { db } from "@/lib/db";
import { orderItems, orders, shifts, tableSessions } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauth" }, { status: 401 });
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "no tenant" }, { status: 404 });

  const { id } = await ctx.params;

  // Ownership check: el turno debe pertenecer al tenant actual.
  const [shift] = await db
    .select()
    .from(shifts)
    .where(and(eq(shifts.id, id), eq(shifts.tenantId, bundle.tenant.id)))
    .limit(1);
  if (!shift) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Pedidos del turno + método de pago (LEFT JOIN a tableSessions para dine-in)
  // + contador de items en una subquery para no N+1.
  const rows = await db
    .select({
      id: orders.id,
      createdAt: orders.createdAt,
      paidAt: orders.paidAt,
      tableNumber: orders.tableNumber,
      customerName: orders.customerName,
      subtotalCents: orders.subtotalCents,
      taxCents: orders.taxCents,
      totalCents: orders.totalCents,
      status: orders.status,
      stripePaymentIntentId: orders.stripePaymentIntentId,
      sessionPaymentMethod: tableSessions.paymentMethod,
      itemsCount: sql<number>`(
        SELECT coalesce(sum(${orderItems.quantity}), 0)::int
        FROM ${orderItems}
        WHERE ${orderItems.orderId} = ${orders.id}
      )`,
    })
    .from(orders)
    .leftJoin(tableSessions, eq(tableSessions.id, orders.sessionId))
    .where(and(
      eq(orders.shiftId, shift.id),
      eq(orders.tenantId, bundle.tenant.id),
      eq(orders.isTest, false),
    ))
    .orderBy(asc(orders.createdAt));

  const header = [
    "pedido_id",
    "created_at",
    "paid_at",
    "table_number",
    "customer_name",
    "subtotal_cents",
    "tax_cents",
    "total_cents",
    "status",
    "payment_method",
    "items_count",
  ] as const;

  const body = rows.map((r) => {
    // Resolución de payment_method: 1) sesión de mesa (cash/card_terminal),
    // 2) Stripe payment intent → "stripe", 3) vacío si no se pagó.
    const paymentMethod = r.sessionPaymentMethod
      ?? (r.stripePaymentIntentId ? "stripe" : "");
    return [
      csvEscape(r.id),
      r.createdAt.toISOString(),
      r.paidAt ? r.paidAt.toISOString() : "",
      csvEscape(r.tableNumber ?? ""),
      csvEscape(r.customerName ?? ""),
      centsToAmount(r.subtotalCents),
      centsToAmount(r.taxCents),
      centsToAmount(r.totalCents),
      csvEscape(r.status),
      csvEscape(paymentMethod),
      String(r.itemsCount ?? 0),
    ];
  });

  const csv = csvJoin(header, body);
  const filename = csvFilename({
    base: "turno",
    tenantSlug: bundle.tenant.slug,
    id: shift.id,
    date: shift.openedAt,
  });

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
