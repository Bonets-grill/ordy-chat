// web/app/api/knowledge/route.ts — Gestión de FAQs + métodos de pago + notas.
//
// GET   → estado actual
// PATCH → actualiza payment_methods / accept_online_payment / payment_notes
// El tenant edita FAQs por separado en /api/knowledge/faqs.

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { agentConfigs, faqs } from "@/lib/db/schema";
import { regenerateTenantPrompt } from "@/lib/prompt-regen";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";

const VALID_METHODS = ["online", "on_pickup", "on_delivery", "cash", "card_in_person", "bizum", "transfer"] as const;
type PayMethod = (typeof VALID_METHODS)[number];

const patchSchema = z.object({
  paymentMethods: z.array(z.enum(VALID_METHODS)).min(1).optional(),
  acceptOnlinePayment: z.boolean().optional(),
  paymentNotes: z.string().max(500).nullable().optional(),
});

export async function GET() {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const [cfg] = await db
    .select({
      paymentMethods: agentConfigs.paymentMethods,
      acceptOnlinePayment: agentConfigs.acceptOnlinePayment,
      paymentNotes: agentConfigs.paymentNotes,
      knowledge: agentConfigs.knowledge,
    })
    .from(agentConfigs)
    .where(eq(agentConfigs.tenantId, bundle.tenant.id))
    .limit(1);

  const faqRows = await db
    .select()
    .from(faqs)
    .where(eq(faqs.tenantId, bundle.tenant.id))
    .orderBy(faqs.orderIndex);

  return NextResponse.json({
    paymentMethods: cfg?.paymentMethods ?? ["on_pickup", "cash"],
    acceptOnlinePayment: cfg?.acceptOnlinePayment ?? false,
    paymentNotes: cfg?.paymentNotes ?? null,
    knowledge: cfg?.knowledge ?? [],
    faqs: faqRows.map((f) => ({
      id: f.id,
      question: f.question,
      answer: f.answer,
      orderIndex: f.orderIndex,
    })),
  });
}

export async function PATCH(req: Request) {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_input", issues: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;

  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (d.paymentMethods) update.paymentMethods = d.paymentMethods as PayMethod[];
  if (typeof d.acceptOnlinePayment === "boolean") update.acceptOnlinePayment = d.acceptOnlinePayment;
  if (d.paymentNotes !== undefined) update.paymentNotes = d.paymentNotes;

  if (Object.keys(update).length > 1) {
    await db.update(agentConfigs).set(update).where(eq(agentConfigs.tenantId, bundle.tenant.id));
    await regenerateTenantPrompt(bundle.tenant.id);
  }

  return NextResponse.json({ ok: true });
}
