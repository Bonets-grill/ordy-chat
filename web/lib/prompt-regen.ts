// web/lib/prompt-regen.ts — Regenera el system_prompt del tenant tras editar
// FAQs / métodos de pago / cualquier campo que afecte comportamiento del agente.

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentConfigs, faqs, tenants } from "@/lib/db/schema";
import { buildSystemPrompt } from "@/lib/prompt-builder";

export async function regenerateTenantPrompt(tenantId: string): Promise<void> {
  const [cfg] = await db
    .select()
    .from(agentConfigs)
    .where(eq(agentConfigs.tenantId, tenantId))
    .limit(1);
  if (!cfg) return;

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  const businessName = tenant?.name ?? cfg.businessName;

  const faqRows = await db
    .select({ question: faqs.question, answer: faqs.answer })
    .from(faqs)
    .where(eq(faqs.tenantId, tenantId))
    .orderBy(faqs.orderIndex);

  const knowledgeArray = Array.isArray(cfg.knowledge) ? (cfg.knowledge as Array<{ type?: string; content?: string }>) : [];
  const knowledgeText = knowledgeArray
    .map((k) => (k?.content ?? "").trim())
    .filter(Boolean)
    .join("\n\n");

  const systemPrompt = buildSystemPrompt({
    businessName,
    businessDescription: cfg.businessDescription ?? "",
    agentName: cfg.agentName,
    tone: cfg.tone as "professional" | "friendly" | "sales" | "empathetic",
    schedule: cfg.schedule,
    useCases: Array.isArray(cfg.useCases) ? (cfg.useCases as string[]) : [],
    knowledgeText,
    faqs: faqRows,
    paymentMethods: cfg.paymentMethods ?? ["on_pickup", "cash"],
    acceptOnlinePayment: cfg.acceptOnlinePayment ?? false,
    paymentNotes: cfg.paymentNotes,
    taxLabel: tenant?.taxLabel ?? "IVA",
    taxRateStandard: parseFloat(tenant?.taxRateStandard ?? "10"),
    pricesIncludeTax: tenant?.pricesIncludeTax ?? true,
  });

  await db
    .update(agentConfigs)
    .set({ systemPrompt, updatedAt: new Date() })
    .where(eq(agentConfigs.tenantId, tenantId));
}
