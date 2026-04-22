// web/app/api/kds/reject/route.ts
//
// Cocina rechaza un pedido en estado 'pending_kitchen_review' con razón. Tras
// rechazar:
//   - kitchenDecision = 'rejected', kitchenDecisionReason = razón.
//   - status pasa a 'canceled'.
//
// Razones predefinidas (validadas como enum) + 'other' con texto libre.

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { agentConfigs, orders } from "@/lib/db/schema";
import { requireTenantOrKiosk } from "@/lib/kiosk-auth";

export const runtime = "nodejs";

async function notifyCustomerRejection(args: {
  tenantId: string;
  customerPhone: string;
  reasonKey: string;
  detail?: string;
  businessName: string;
}): Promise<void> {
  const runtimeUrl = (process.env.RUNTIME_URL ?? "").replace(/\/$/, "");
  const secret = process.env.RUNTIME_INTERNAL_SECRET ?? "";
  if (!runtimeUrl || !secret) return;
  try {
    await fetch(`${runtimeUrl}/internal/orders/notify-rejection`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": secret },
      body: JSON.stringify({
        tenant_id: args.tenantId,
        customer_phone: args.customerPhone,
        reason_key: args.reasonKey,
        detail: args.detail,
        business_name: args.businessName,
      }),
    });
  } catch {
    // best-effort
  }
}

// Las razones predefinidas viven como enum aquí + en kds-board.tsx para la UI.
// Si añades una nueva, añade también la traducción en KITCHEN_REJECT_REASONS.
export const KITCHEN_REJECT_REASON_KEYS = [
  "closing_soon",
  "too_busy",
  "out_of_stock",
  "temporarily_unavailable",
  "kitchen_problem",
  "other",
] as const;

const rejectSchema = z.object({
  orderId: z.string().min(1),
  reasonKey: z.enum(KITCHEN_REJECT_REASON_KEYS),
  // detail es opcional pero requerido para 'out_of_stock' y 'other'.
  detail: z.string().max(280).optional(),
}).refine(
  (d) => !["out_of_stock", "temporarily_unavailable", "other"].includes(d.reasonKey) ||
         (d.detail != null && d.detail.trim().length > 0),
  { message: "detail requerido para out_of_stock | temporarily_unavailable | other", path: ["detail"] },
);

export async function POST(req: Request) {
  const bundle = await requireTenantOrKiosk(req);
  if (!bundle) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = rejectSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_input", issues: parsed.error.flatten() }, { status: 400 });
  }

  const { orderId, reasonKey, detail } = parsed.data;

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

  // Construimos el reason persistido como `key:detail` para que la Fase 5 (webhook
  // a cliente) pueda parsearlo y traducir a mensaje humano. Si es out_of_stock,
  // detail es el nombre del producto faltante → bot sugiere alternativa.
  const reasonStored = detail ? `${reasonKey}:${detail}` : reasonKey;

  const [updated] = await db
    .update(orders)
    .set({
      kitchenDecision: "rejected",
      kitchenDecisionReason: reasonStored,
      status: "canceled",
      updatedAt: new Date(),
    })
    .where(eq(orders.id, orderId))
    .returning({
      id: orders.id,
      status: orders.status,
      kitchenDecisionReason: orders.kitchenDecisionReason,
      customerPhone: orders.customerPhone,
    });

  if (updated?.customerPhone) {
    const [cfg] = await db
      .select({ businessName: agentConfigs.businessName })
      .from(agentConfigs)
      .where(eq(agentConfigs.tenantId, bundle.tenant.id))
      .limit(1);
    await notifyCustomerRejection({
      tenantId: bundle.tenant.id,
      customerPhone: updated.customerPhone,
      reasonKey,
      detail,
      businessName: cfg?.businessName ?? "el restaurante",
    });
  }

  return NextResponse.json({ ok: true, order: updated });
}
