// web/app/api/orders/[id]/route.ts
//
// PATCH /api/orders/[id] — endpoint para que el dashboard/KDS actualice
// campos editables de una orden. Hoy: método de pago + marcar como pagado
// + propina (mig 041).
//
// Body (parcial):
//   { paymentMethod?: 'cash'|'card'|'transfer'|'other',
//     markPaid?: boolean,
//     tipCents?: number  // 0..10000, default 0 (mig 041)
//   }
//
// Reglas:
//   - markPaid=true sin paymentMethod → default 'cash' (flow "camarero cobra en caja").
//   - solo paymentMethod (sin markPaid) → actualiza el método (corrección admin).
//   - tipCents acompaña a markPaid (camarero introduce propina al cobrar) o
//     puede pasarse solo (admin corrige propina post-cobro).
//   - Valida ownership del tenant (404 si el pedido no pertenece al tenant auth).
//
// Auth: tenant session (Auth.js) o kiosk token (KDS pública). Reutilizamos
// requireTenantOrKiosk para ambos caminos.

import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { requireTenantOrKiosk } from "@/lib/kiosk-auth";
import { markOrderPaidManual } from "@/lib/orders";
import { ORDER_PAYMENT_METHODS } from "@/lib/payment-methods";

export const runtime = "nodejs";

const patchSchema = z
  .object({
    paymentMethod: z.enum(ORDER_PAYMENT_METHODS).optional(),
    markPaid: z.boolean().optional(),
    // Mig 041: propina en céntimos. Cap de 100€ — más que eso lo más probable
    // es un typo (1000 → "10.00€" mal interpretado como 1000.00€).
    tipCents: z.number().int().min(0).max(100_00).optional(),
  })
  .refine(
    (d) => d.paymentMethod !== undefined || d.markPaid !== undefined || d.tipCents !== undefined,
    { message: "body vacío: usa paymentMethod, markPaid y/o tipCents" },
  );

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const bundle = await requireTenantOrKiosk(req);
  if (!bundle) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "bad_order_id" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "bad_input", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Ownership: el pedido debe pertenecer al tenant autenticado. Si no, 404
  // (no filtramos existencia cross-tenant para evitar enumeración).
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, id), eq(orders.tenantId, bundle.tenant.id)))
    .limit(1);
  if (!order) {
    return NextResponse.json({ error: "order_not_found" }, { status: 404 });
  }

  // Caso A: markPaid=true. Usa markOrderPaidManual (valida ownership otra vez
  // internamente y es idempotente). El método es el que venga en body o 'cash'.
  // Mig 041: si viene tipCents en el mismo request, lo guardamos en un UPDATE
  // adicional tras marcar pagado (markOrderPaidManual no toca tip_cents para
  // mantener API estable; ese path lo seguirán usando webhooks Stripe sin propina).
  if (parsed.data.markPaid) {
    const method = parsed.data.paymentMethod ?? "cash";
    const updated = await markOrderPaidManual(order.id, bundle.tenant.id, method);
    if (!updated) {
      return NextResponse.json({ error: "order_not_found" }, { status: 404 });
    }
    if (parsed.data.tipCents !== undefined) {
      const [withTip] = await db
        .update(orders)
        .set({ tipCents: parsed.data.tipCents, updatedAt: new Date() })
        .where(and(eq(orders.id, order.id), eq(orders.tenantId, bundle.tenant.id)))
        .returning();
      return NextResponse.json({ ok: true, order: withTip ?? updated });
    }
    return NextResponse.json({ ok: true, order: updated });
  }

  // Caso B: paymentMethod y/o tipCents sueltos → update plano. Sirve para
  // corregir el método o la propina de un pedido ya pagado (admin retoca).
  if (parsed.data.paymentMethod !== undefined || parsed.data.tipCents !== undefined) {
    const updates: Partial<{ paymentMethod: typeof parsed.data.paymentMethod; tipCents: number; updatedAt: Date }> = {
      updatedAt: new Date(),
    };
    if (parsed.data.paymentMethod !== undefined) updates.paymentMethod = parsed.data.paymentMethod;
    if (parsed.data.tipCents !== undefined) updates.tipCents = parsed.data.tipCents;
    const [updated] = await db
      .update(orders)
      .set(updates)
      .where(and(eq(orders.id, order.id), eq(orders.tenantId, bundle.tenant.id)))
      .returning();
    return NextResponse.json({ ok: true, order: updated });
  }

  // Unreachable por el refine del schema, pero TS no lo sabe.
  return NextResponse.json({ error: "bad_input" }, { status: 400 });
}
