// web/app/api/kds/accept/route.ts
//
// Cocina acepta un pedido en estado 'pending_kitchen_review' con un ETA en
// minutos (5-120). Tras aceptar:
//   - kitchenDecision = 'accepted', pickupEtaMinutes = X.
//   - status pasa a 'pending' (entra al flujo KDS normal) hasta que Fase 5+6
//     metan el handshake con el cliente vía WhatsApp.
//
// Auth: session de tenant (Auth.js) — solo el tenant dueño puede aceptar.

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";

const acceptSchema = z.object({
  orderId: z.string().min(1),
  etaMinutes: z.number().int().min(5).max(120),
});

export async function POST(req: Request) {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = acceptSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_input", issues: parsed.error.flatten() }, { status: 400 });
  }

  const { orderId, etaMinutes } = parsed.data;

  const [current] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.tenantId, bundle.tenant.id)))
    .limit(1);
  if (!current) return NextResponse.json({ error: "order_not_found" }, { status: 404 });
  if (current.status !== "pending_kitchen_review") {
    return NextResponse.json(
      { error: "order_not_in_review", currentStatus: current.status },
      { status: 409 },
    );
  }
  if (current.kitchenDecision !== "pending") {
    return NextResponse.json(
      { error: "kitchen_already_decided", current: current.kitchenDecision },
      { status: 409 },
    );
  }

  const [updated] = await db
    .update(orders)
    .set({
      kitchenDecision: "accepted",
      pickupEtaMinutes: etaMinutes,
      status: "pending",
      updatedAt: new Date(),
    })
    .where(eq(orders.id, orderId))
    .returning({ id: orders.id, status: orders.status, pickupEtaMinutes: orders.pickupEtaMinutes });

  // Fase 5: aquí dispararíamos un WA al cliente con la propuesta de ETA.
  // Por ahora la transición es directa a 'pending' y el cliente verá el ETA
  // cuando pase a recoger / cuando un humano se lo notifique.

  return NextResponse.json({ ok: true, order: updated });
}
