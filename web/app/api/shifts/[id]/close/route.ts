// POST /api/shifts/[id]/close
// Cierra el turno. Calcula el esperado en caja (opening + cobros en efectivo del turno).
// Mig 040: tras cerrar, dispara WA al dueño/encargado con el cuadre (fire-and-forget).
// Si la columna payment_method (mig 039) todavía no está en DB, el breakdown
// degrada a "cobrado total" sin separar cash/card — así el feature funciona
// independientemente del orden de merge.
import { and, eq, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { orderItems, orders, shifts } from "@/lib/db/schema";
import { queuePosReport } from "@/lib/pos-reports";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";

const bodySchema = z.object({
  countedCashCents: z.number().int().min(0).max(100_000_00), // 100.000€
  notes: z.string().max(500).optional(),
});

type Ctx = { params: Promise<{ id: string }> };

type Breakdown = {
  cashCents: number | null;
  cardCents: number | null;
  otherCents: number | null;
};

/**
 * Intenta agregar total por método de pago. Si la columna payment_method no
 * existe (mig 039 aún no mergeada), devuelve null en cada bucket — el helper
 * del mensaje degrada a "cobrado total".
 */
async function fetchPaymentBreakdown(shiftId: string): Promise<Breakdown> {
  try {
    const rows = (await db.execute(sql`
      SELECT
        COALESCE(payment_method, 'cash') AS method,
        COALESCE(SUM(total_cents), 0)::int AS total
      FROM orders
      WHERE shift_id = ${shiftId}
        AND is_test = false
        AND paid_at IS NOT NULL
      GROUP BY COALESCE(payment_method, 'cash')
    `)) as unknown as Array<{ method: string; total: number }>;
    let cash = 0;
    let card = 0;
    let other = 0;
    for (const r of rows) {
      if (r.method === "cash") cash += r.total;
      else if (r.method === "card") card += r.total;
      else other += r.total;
    }
    return { cashCents: cash, cardCents: card, otherCents: other };
  } catch {
    // Columna payment_method no existe todavía → degradar.
    return { cashCents: null, cardCents: null, otherCents: null };
  }
}

export async function POST(req: Request, ctx: Ctx) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauth" }, { status: 401 });
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "no tenant" }, { status: 404 });

  const { id } = await ctx.params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_input", issues: parsed.error.flatten() }, { status: 400 });
  }

  // El turno debe existir, ser del tenant, estar abierto.
  const [shift] = await db
    .select()
    .from(shifts)
    .where(and(
      eq(shifts.id, id),
      eq(shifts.tenantId, bundle.tenant.id),
      isNull(shifts.closedAt),
    ))
    .limit(1);

  if (!shift) {
    return NextResponse.json({ error: "not_found_or_already_closed" }, { status: 404 });
  }

  // Total cobrado en el turno (no incluye tests).
  const [paidSum] = await db
    .select({
      total: sql<number>`coalesce(sum(${orders.totalCents}) FILTER (WHERE ${orders.paidAt} IS NOT NULL), 0)::int`,
      count: sql<number>`count(*) FILTER (WHERE ${orders.paidAt} IS NOT NULL)::int`,
    })
    .from(orders)
    .where(and(eq(orders.shiftId, shift.id), eq(orders.isTest, false)));
  const paidCents = paidSum?.total ?? 0;
  const paidCount = paidSum?.count ?? 0;
  const expectedCashCents = shift.openingCashCents + paidCents;
  const diffCents = parsed.data.countedCashCents - expectedCashCents;

  const notes =
    (parsed.data.notes ?? "").trim() ||
    (shift.notes ?? null);

  const [updated] = await db
    .update(shifts)
    .set({
      closedAt: new Date(),
      closedBy: session.user?.email ?? null,
      countedCashCents: parsed.data.countedCashCents,
      notes: notes ?? null,
      updatedAt: new Date(),
    })
    .where(eq(shifts.id, shift.id))
    .returning();

  // Mig 040: dispara WA con el cuadre. Fire-and-forget, respuesta no espera.
  try {
    const breakdown = await fetchPaymentBreakdown(shift.id);

    const top3 = await db
      .select({
        name: orderItems.name,
        quantity: sql<number>`sum(${orderItems.quantity})::int`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(and(eq(orders.shiftId, shift.id), eq(orders.isTest, false)))
      .groupBy(orderItems.name)
      .orderBy(sql`sum(${orderItems.quantity}) DESC`)
      .limit(3);

    queuePosReport(bundle.tenant.id, "shift_closed", {
      openedAt: shift.openedAt,
      closedAt: updated?.closedAt ?? new Date(),
      orderCount: paidCount,
      totalCents: paidCents,
      openingCashCents: shift.openingCashCents,
      cashCents: breakdown.cashCents,
      cardCents: breakdown.cardCents,
      otherCents: breakdown.otherCents,
      expectedCashCents,
      countedCashCents: parsed.data.countedCashCents,
      diffCents,
      topItems: top3,
    });
  } catch (err) {
    // No bloqueamos la respuesta si algo revienta al agregar datos WA.
    console.error("[shifts/close] WA report build failed:", err);
  }

  return NextResponse.json({
    ok: true,
    shift: updated,
    report: {
      openingCashCents: shift.openingCashCents,
      paidCents,
      expectedCashCents,
      countedCashCents: parsed.data.countedCashCents,
      diffCents,
    },
  });
}
