// web/lib/onboarding-fast/provision.ts — Creación de tenant a partir de CanonicalBusiness.
//
// Lógica extraída de app/api/onboarding/route.ts (wizard tradicional) para que
// ambos flujos (wizard y fast) la reusen. Cambios en este archivo afectan a los
// dos onboardings — test de regresión obligatorio en `provision.test.ts`.
//
// Contrato: el caller valida la sesión y autorización. provision NO hace auth.

import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { cifrar } from "@/lib/crypto";
import { db } from "@/lib/db";
import { agentConfigs, providerCredentials, tenantMembers, tenants } from "@/lib/db/schema";
import { createInstance, evolutionConfigured, evolutionInstanceName } from "@/lib/evolution";
import { buildSystemPrompt } from "@/lib/prompt-builder";
import { slugify } from "@/lib/utils";
import { buildAgentConfigInsert, mapCanonicalToWizardFields } from "./provision-mappers";
import type {
  ProvisionInput,
  ProvisionProvider,
  ProvisionResult,
  ProvisionTone,
} from "./provision-mappers";

// Re-export para que los callers importen todo desde "./provision".
export {
  buildAgentConfigInsert,
  mapCanonicalToWizardFields,
} from "./provision-mappers";
export type {
  ProvisionInput,
  ProvisionProvider,
  ProvisionResult,
  ProvisionTone,
  AgentWizardFields,
} from "./provision-mappers";

export class ProvisionError extends Error {
  constructor(
    public code: "existing_tenant" | "evolution_not_configured" | "runtime_url_missing" | "evolution_create_failed",
    message: string,
    public httpStatus: number,
  ) {
    super(message);
    this.name = "ProvisionError";
  }
}

// ─────────────────────────────────────────────────────────────
// Operaciones con DB (los mappers puros viven en ./provision-mappers.ts)
// ─────────────────────────────────────────────────────────────

async function uniqueSlug(base: string): Promise<string> {
  const cleaned = slugify(base) || "negocio";
  for (let i = 0; i < 20; i++) {
    const candidate = i === 0 ? cleaned : `${cleaned}-${i + 1}`;
    const [existing] = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, candidate))
      .limit(1);
    if (!existing) return candidate;
  }
  return `${cleaned}-${Date.now()}`;
}

async function userHasTenant(userId: string): Promise<boolean> {
  const existing = await db
    .select({ id: tenants.id })
    .from(tenantMembers)
    .innerJoin(tenants, eq(tenants.id, tenantMembers.tenantId))
    .where(and(eq(tenantMembers.userId, userId), eq(tenants.ownerUserId, userId)))
    .limit(1);
  return existing.length > 0;
}

/**
 * Crea tenant + agent_config + provider_credentials + (si evolution) instancia.
 * Atómico por fases: si una falla lanza ProvisionError; el caller decide rollback.
 *
 * NOTA: actualmente NO hay transacción DB porque Drizzle + @neondatabase/serverless
 * no soporta transactions cross-statement de forma limpia en el modelo existente.
 * Consistencia se asegura por el orden: tenants → member → agent_config →
 * evolution (idempotente por instance_name) → provider_credentials. Si falla
 * entre pasos, el tenant queda sin credenciales y el usuario ve un error
 * → puede reintentar porque userHasTenant lo bloquearía. Mejora futura:
 * cleanup endpoint admin que purga tenants huérfanos.
 */
export async function createTenantFromCanonical(input: ProvisionInput): Promise<ProvisionResult> {
  // 1. Validar que el user no tiene ya un tenant.
  if (await userHasTenant(input.userId)) {
    throw new ProvisionError(
      "existing_tenant",
      "Ya tienes un tenant. Edita desde el dashboard.",
      409,
    );
  }

  // 2. Validar prerequisitos de provider.
  if (input.provider === "evolution" && !evolutionConfigured()) {
    throw new ProvisionError(
      "evolution_not_configured",
      "Evolution no está configurado en la plataforma. Contacta al administrador.",
      503,
    );
  }

  // 3. System prompt desde campos wizard-compatibles.
  const wizard = mapCanonicalToWizardFields(input);
  const systemPrompt = buildSystemPrompt(wizard);

  // 4. Slug único + trial.
  const slug = await uniqueSlug(input.canonical.name);
  const trialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  // 5. INSERT tenants.
  const [tenant] = await db
    .insert(tenants)
    .values({
      slug,
      name: input.canonical.name,
      ownerUserId: input.userId,
      trialEndsAt,
    })
    .returning();

  // 6. INSERT tenant_members.
  await db.insert(tenantMembers).values({
    tenantId: tenant.id,
    userId: input.userId,
    role: "owner",
  });

  // 7. INSERT agent_configs.
  await db.insert(agentConfigs).values(buildAgentConfigInsert(input, tenant.id, systemPrompt));

  // 8. Webhook secret (shared con Whapi/Evolution; Meta/Twilio firman directamente).
  const webhookSecret = crypto.randomBytes(24).toString("base64url");

  // 9. Provisioning Evolution (solo para ese provider).
  const credsPayload: Record<string, string> = { ...(input.providerCredentials ?? {}) };

  if (input.provider === "evolution") {
    const instanceName = evolutionInstanceName(slug);
    const runtimeUrl = (process.env.RUNTIME_URL ?? "").replace(/\/$/, "");
    if (!runtimeUrl) {
      throw new ProvisionError("runtime_url_missing", "RUNTIME_URL no configurada", 503);
    }
    const webhookUrl = `${runtimeUrl}/webhook/evolution/${slug}`;
    try {
      await createInstance(instanceName, webhookUrl, { webhookSecret });
    } catch (err) {
      console.error("[provision] evolution createInstance fail:", err);
      throw new ProvisionError(
        "evolution_create_failed",
        `No se pudo crear la instancia de WhatsApp: ${err instanceof Error ? err.message : String(err)}`,
        502,
      );
    }
    credsPayload.instance_name = instanceName;
  }

  // 10. INSERT provider_credentials.
  await db.insert(providerCredentials).values({
    tenantId: tenant.id,
    provider: input.provider,
    credentialsEncrypted: cifrar(JSON.stringify(credsPayload)),
    phoneNumber: input.providerCredentials?.phone_number ?? null,
    webhookSecret,
  });

  return { slug, tenantId: tenant.id };
}
