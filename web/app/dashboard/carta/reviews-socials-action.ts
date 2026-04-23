"use server";

// Server action para editar enlaces de reseña + redes sociales (mig 033).
// Post-cuenta: el agente los comparte tras cobrar la mesa.

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { agentConfigs, auditLog } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";

// URL válida, o string vacío para borrar.
const urlOrEmpty = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === "" || /^https?:\/\/.+/i.test(v), {
    message: "Debe ser una URL https:// (o vacío para borrar)",
  });

const payloadSchema = z.object({
  reviewGoogleUrl: urlOrEmpty,
  reviewTripadvisorUrl: urlOrEmpty,
  socialInstagramUrl: urlOrEmpty,
  socialFacebookUrl: urlOrEmpty,
  socialTiktokUrl: urlOrEmpty,
});

// NOTA: "use server" files sólo pueden exportar async functions. El tipo del
// input vive inline en el editor client (reviews-socials-editor.tsx) —
// mismos campos que este schema. Si hay que cambiar la shape, cambiar ambos.

export async function setReviewsSocialsAction(input: {
  reviewGoogleUrl: string;
  reviewTripadvisorUrl: string;
  socialInstagramUrl: string;
  socialFacebookUrl: string;
  socialTiktokUrl: string;
}) {
  const session = await auth();
  const bundle = await requireTenant();
  if (!session?.user?.id || !bundle) {
    return { ok: false as const, error: "no_tenant" };
  }
  const parsed = payloadSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false as const,
      error: parsed.error.issues[0]?.message ?? "input_invalido",
    };
  }
  const clean = parsed.data;
  const toNull = (v: string): string | null => (v === "" ? null : v);

  await db
    .update(agentConfigs)
    .set({
      reviewGoogleUrl: toNull(clean.reviewGoogleUrl),
      reviewTripadvisorUrl: toNull(clean.reviewTripadvisorUrl),
      socialInstagramUrl: toNull(clean.socialInstagramUrl),
      socialFacebookUrl: toNull(clean.socialFacebookUrl),
      socialTiktokUrl: toNull(clean.socialTiktokUrl),
      updatedAt: new Date(),
    })
    .where(eq(agentConfigs.tenantId, bundle.tenant.id));

  await db.insert(auditLog).values({
    tenantId: bundle.tenant.id,
    userId: session.user.id,
    action: "tenant_set_reviews_socials",
    entity: "agent_configs",
    entityId: bundle.tenant.id,
    metadata: {
      has_google: !!toNull(clean.reviewGoogleUrl),
      has_tripadvisor: !!toNull(clean.reviewTripadvisorUrl),
      has_instagram: !!toNull(clean.socialInstagramUrl),
      has_facebook: !!toNull(clean.socialFacebookUrl),
      has_tiktok: !!toNull(clean.socialTiktokUrl),
    },
  });

  revalidatePath("/dashboard/carta");
  return { ok: true as const };
}
