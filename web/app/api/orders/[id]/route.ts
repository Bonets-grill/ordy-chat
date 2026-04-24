// web/app/api/orders/[id]/route.ts
//
// PATCH /api/orders/[id] — endpoint para que el dashboard/KDS actualice
// campos editables de una orden. Hoy: método de pago + marcar como pagado.
//
// Body (parcial):
//   { paymentMethod?: 'cash'|'card'|'transfer'|'other', markPaid?: boolean }
//
// Reglas:
//   - markPaid=true sin paymentMethod → default 'cash' (flow "camarero cobra en caja").
//   - solo paymentMethod (sin markPaid) → actualiza el método (corrección admin).
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
  })
  .refine(
    (d) => d.paymentMethod !== undefined || d.markPaid !== undefined,
    { message: "body vacío: usa paymentMethod y/o markPaid" },
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
  if (parsed.data.markPaid) {
    const method = parsed.data.paymentMethod ?? "cash";
    const updated = await markOrderPaidManual(order.id, bundle.tenant.id, method);
    if (!updated) {
      return NextResponse.json({ error: "order_not_found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, order: updated });
  }

  // Caso B: solo paymentMethod → update plano. Sirve para corregir el método
  // de un pedido ya pagado (e.g. se marcó cash y era tarjeta).
  if (parsed.data.paymentMethod !== undefined) {
    const [updated] = await db
      .update(orders)
      .set({
        paymentMethod: parsed.data.paymentMethod,
        updatedAt: new Date(),
      })
      .where(and(eq(orders.id, order.id), eq(orders.tenantId, bundle.tenant.id)))
      .returning();
    return NextResponse.json({ ok: true, order: updated });
  }

  // Unreachable por el refine del schema, pero TS no lo sabe.
  return NextResponse.json({ error: "bad_input" }, { status: 400 });
}
