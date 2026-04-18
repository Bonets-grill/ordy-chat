// web/app/api/orders/[id]/pay/route.ts
//
// Genera un Stripe Checkout Session para la orden y devuelve la URL.
// Llamado por el runtime (al pedir cobro) o por el dashboard del tenant.

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { createPaymentLink } from "@/lib/orders";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: orderId } = await params;

  // Autorización: runtime con shared secret O super-admin (futuro).
  const provided = req.headers.get("x-internal-secret") ?? "";
  const expected = process.env.RUNTIME_INTERNAL_SECRET ?? "";
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return NextResponse.json({ error: "order_not_found" }, { status: 404 });

  // Si ya tiene link vigente y la orden sigue awaiting_payment, reutilizarlo.
  if (order.stripePaymentLinkUrl && order.status === "awaiting_payment") {
    return NextResponse.json({ kind: "online", url: order.stripePaymentLinkUrl, reused: true });
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "https://ordychat.ordysuite.com";

  try {
    const result = await createPaymentLink(orderId, baseUrl);
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
