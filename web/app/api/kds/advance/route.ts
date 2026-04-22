// web/app/api/kds/advance/route.ts
// POST { orderId } — avanza el status del pedido por el flujo
// pending → preparing → ready → served. Valida ownership tenant.

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { requireTenantOrKiosk } from "@/lib/kiosk-auth";

export const runtime = "nodejs";

const NEXT_STATUS: Record<string, string | undefined> = {
  pending: "preparing",
  preparing: "ready",
  ready: "served",
};

export async function POST(req: Request) {
  const bundle = await requireTenantOrKiosk(req);
  if (!bundle) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { orderId?: string };
  const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
  if (!orderId) {
    return NextResponse.json({ error: "missing_order_id" }, { status: 400 });
  }

  const [current] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.tenantId, bundle.tenant.id)))
    .limit(1);

  if (!current) {
    return NextResponse.json({ error: "order_not_found" }, { status: 404 });
  }

  const nextStatus = NEXT_STATUS[current.status];
  if (!nextStatus) {
    return NextResponse.json(
      { error: "already_final", status: current.status },
      { status: 409 },
    );
  }

  await db
    .update(orders)
    .set({ status: nextStatus, updatedAt: new Date() })
    .where(eq(orders.id, orderId));

  return NextResponse.json({ ok: true, orderId, status: nextStatus });
}
