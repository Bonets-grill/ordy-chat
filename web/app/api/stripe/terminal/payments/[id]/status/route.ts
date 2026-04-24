// web/app/api/stripe/terminal/payments/[id]/status/route.ts
//
// GET /api/stripe/terminal/payments/[id]/status — devuelve el estado del cobro.
// El cliente (KDS o /dashboard/tpv) hace polling cada 2s hasta que llegue a
// 'succeeded' o 'failed'/'canceled'.
//
// El [id] es pos_payments.id (UUID interno) — no expone el PaymentIntent.
//
// Mig 045.

import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { posPayments } from "@/lib/db/schema";
import { requireTenantOrKiosk } from "@/lib/kiosk-auth";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const bundle = await requireTenantOrKiosk(req);
  if (!bundle) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "bad_id" }, { status: 400 });
  }

  const [row] = await db
    .select()
    .from(posPayments)
    .where(and(eq(posPayments.id, id), eq(posPayments.tenantId, bundle.tenant.id)))
    .limit(1);
  if (!row) {
    return NextResponse.json({ error: "payment_not_found" }, { status: 404 });
  }

  return NextResponse.json({
    id: row.id,
    orderId: row.orderId,
    status: row.status,
    amountCents: row.amountCents,
    currency: row.currency,
    paymentIntentId: row.paymentIntentId,
    updatedAt: row.updatedAt.toISOString(),
  });
}
