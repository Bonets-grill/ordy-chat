"use server";

// Server action para editar agent_configs.drinks_greeting_pitch (mig 031).
// Texto libre que usa el bot en el flujo QR-de-mesa cuando el cliente abre
// /m/<slug>?mesa=N. El bot ofrece literalmente esas bebidas en el primer
// turno en vez de inventar.

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { agentConfigs, auditLog } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";

const pitchSchema = z
  .string()
  .trim()
  .max(500, "Máximo 500 caracteres — haz la oferta corta, el mesero la lee en voz alta");

export async function setDrinksGreetingPitchAction(rawPitch: string) {
  const session = await auth();
  const bundle = await requireTenant();
  if (!session?.user?.id || !bundle) {
    return { ok: false as const, error: "no_tenant" };
  }
  const parsed = pitchSchema.safeParse(rawPitch);
  if (!parsed.success) {
    return {
      ok: false as const,
      error: parsed.error.issues[0]?.message ?? "pitch_invalido",
    };
  }
  const value: string | null = parsed.data.length === 0 ? null : parsed.data;

  await db
    .update(agentConfigs)
    .set({ drinksGreetingPitch: value, updatedAt: new Date() })
    .where(eq(agentConfigs.tenantId, bundle.tenant.id));

  await db.insert(auditLog).values({
    tenantId: bundle.tenant.id,
    userId: session.user.id,
    action: "tenant_set_drinks_pitch",
    entity: "agent_configs",
    entityId: bundle.tenant.id,
    metadata: { has_pitch: value != null, length: value?.length ?? 0 },
  });

  revalidatePath("/dashboard/carta");
  return { ok: true as const, pitch: value };
}
