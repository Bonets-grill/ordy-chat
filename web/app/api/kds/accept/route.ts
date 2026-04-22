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
import { agentConfigs, orders, tenants } from "@/lib/db/schema";
import { requireTenantOrKiosk } from "@/lib/kiosk-auth";

export const runtime = "nodejs";

async function notifyCustomerEtaAccepted(args: {
  tenantId: string;
  customerPhone: string;
  etaMinutes: number;
  businessName: string;
  totalEur: number;
}): Promise<void> {
  const runtimeUrl = (process.env.RUNTIME_URL ?? "").replace(/\/$/, "");
  const secret = process.env.RUNTIME_INTERNAL_SECRET ?? "";
  if (!runtimeUrl || !secret) return; // dev sin runtime configurado
  try {
    await fetch(`${runtimeUrl}/internal/orders/notify-eta-accepted`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": secret },
      body: JSON.stringify({
        tenant_id: args.tenantId,
        customer_phone: args.customerPhone,
        eta_minutes: args.etaMinutes,
        business_name: args.businessName,
        total_eur: args.totalEur,
      }),
    });
  } catch {
    // best-effort. Si falla, KDS sigue funcionando sin notificación al cliente.
  }
}

const acceptSchema = z.object({
  orderId: z.string().min(1),
  etaMinutes: z.number().int().min(5).max(120),
});

export async function POST(req: Request) {
  const bundle = await requireTenantOrKiosk(req);
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
      // Mig 027 + Fase 5/6: order queda en pending_kitchen_review hasta que cliente
      // confirme el ETA por WhatsApp. Bot procesará la respuesta y avanzará a 'pending'.
      // Si el cliente no responde en X tiempo, un cron eventual cancelará (TBD).
      updatedAt: new Date(),
    })
    .where(eq(orders.id, orderId))
    .returning({
      id: orders.id,
      status: orders.status,
      pickupEtaMinutes: orders.pickupEtaMinutes,
      customerPhone: orders.customerPhone,
      totalCents: orders.totalCents,
    });

  // Notificar al cliente vía WA con la propuesta de ETA. Best-effort.
  // Mig 029: saltamos si el pedido es de playground (customer_phone ficticio
  // "playground-sandbox" — cualquier envío fallaría o peor, sería spam).
  if (updated?.customerPhone && !current.isTest) {
    const [cfg] = await db
      .select({ businessName: agentConfigs.businessName })
      .from(agentConfigs)
      .where(eq(agentConfigs.tenantId, bundle.tenant.id))
      .limit(1);
    await notifyCustomerEtaAccepted({
      tenantId: bundle.tenant.id,
      customerPhone: updated.customerPhone,
      etaMinutes: etaMinutes,
      businessName: cfg?.businessName ?? bundle.tenant.name ?? "el restaurante",
      totalEur: (updated.totalCents ?? 0) / 100,
    });
  }

  return NextResponse.json({ ok: true, order: updated, isTest: current.isTest });
}
