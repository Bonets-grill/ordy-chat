// POST /api/shifts/[id]/close
// Cierra el turno. Calcula el esperado en caja (opening + cobros en efectivo del turno).
// Por ahora asumimos que TODO pedido pagado suma a "esperado efectivo"; si el tenant
// empieza a registrar método de pago, lo filtramos por method='cash' en una iteración.
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

  // Total cobrado en el turno (no incluye tests).
  const [paidSum] = await db
    .select({ total: sql<number>`coalesce(sum(${orders.totalCents}) FILTER (WHERE ${orders.paidAt} IS NOT NULL), 0)::int` })
    .from(orders)
    .where(and(eq(orders.shiftId, shift.id), eq(orders.isTest, false)));
  const paidCents = paidSum?.total ?? 0;
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
      paidCents,
      expectedCashCents,
      countedCashCents: parsed.data.countedCashCents,
      diffCents,
    },
  });
}
