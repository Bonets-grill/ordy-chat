// POST /api/shifts/[id]/close
// Cierra el turno. Calcula el esperado en caja:
//   expected = opening + SUM(total_cents) WHERE payment_method='cash' OR payment_method IS NULL
// Mig 039: payment_method IS NULL → retro-compat (pedidos pre-mig). Card/
// transfer/other NO entran al cuadre — esos no pasan por caja. El total
// general del turno sigue siendo la suma de TODO lo pagado.
import { and, eq, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { orders, shifts } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";

const bodySchema = z.object({
  countedCashCents: z.number().int().min(0).max(100_000_00), // 100.000€
  notes: z.string().max(500).optional(),
});

type Ctx = { params: Promise<{ id: string }> };

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

  // Mig 039: breakdown por método. `paidCents` = cash + NULL (entran en
  // caja). `paidTotalCents` = TODO lo pagado (incluye card/transfer/other)
  // para el resumen general. El cuadre solo usa cash+NULL.
  const [paidSum] = await db
    .select({
      cashPaid: sql<number>`coalesce(sum(${orders.totalCents}) FILTER (WHERE ${orders.paidAt} IS NOT NULL AND (${orders.paymentMethod} = 'cash' OR ${orders.paymentMethod} IS NULL)), 0)::int`,
      cardPaid: sql<number>`coalesce(sum(${orders.totalCents}) FILTER (WHERE ${orders.paidAt} IS NOT NULL AND ${orders.paymentMethod} = 'card'), 0)::int`,
      transferPaid: sql<number>`coalesce(sum(${orders.totalCents}) FILTER (WHERE ${orders.paidAt} IS NOT NULL AND ${orders.paymentMethod} = 'transfer'), 0)::int`,
      otherPaid: sql<number>`coalesce(sum(${orders.totalCents}) FILTER (WHERE ${orders.paidAt} IS NOT NULL AND ${orders.paymentMethod} = 'other'), 0)::int`,
      totalPaid: sql<number>`coalesce(sum(${orders.totalCents}) FILTER (WHERE ${orders.paidAt} IS NOT NULL), 0)::int`,
    })
    .from(orders)
    .where(and(eq(orders.shiftId, shift.id), eq(orders.isTest, false)));
  const paidCents = paidSum?.cashPaid ?? 0;
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

  return NextResponse.json({
    ok: true,
    shift: updated,
    report: {
      openingCashCents: shift.openingCashCents,
      // `paidCents` queda como alias de cash+NULL para retro-compat con
      // clientes que ya leen este campo (dashboard viejo, reportes).
      paidCents,
      expectedCashCents,
      countedCashCents: parsed.data.countedCashCents,
      diffCents,
      // Mig 039: desglose por método — el total del turno es la suma de todo.
      byMethod: {
        cashCents: paidSum?.cashPaid ?? 0,
        cardCents: paidSum?.cardPaid ?? 0,
        transferCents: paidSum?.transferPaid ?? 0,
        otherCents: paidSum?.otherPaid ?? 0,
        totalCents: paidSum?.totalPaid ?? 0,
      },
    },
  });
}
