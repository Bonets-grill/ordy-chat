"use server";

// web/app/admin/tenants/[id]/actions.ts
//
// Sprint 3 validador-ui · Fase 5: acciones super-admin nivel tenant.
//   - setValidationModeAction: override del validation_mode por tenant.
//   - unpauseAgentAction: levanta agent_configs.paused manualmente.
//   - triggerManualRunAction: dispara validator run con rate-limit.

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { adminAction, requireSuperAdmin } from "@/lib/admin/auth";
import { db } from "@/lib/db";
import { agentConfigs, auditLog, tenants } from "@/lib/db/schema";
import { limitByTenantValidatorManual } from "@/lib/rate-limit";

const uuid = z.string().uuid();

const setModeSchema = z.object({
  tenantId: uuid,
  // null = seguir default global de platform_settings.
  mode: z.enum(["auto", "manual", "skip"]).nullable(),
});

async function assertTenantExists(tenantId: string) {
  const [t] = await db
    .select({ id: tenants.id, slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!t) throw new Error("VALIDATION: tenant no existe");
  return t;
}

// ─── setValidationModeAction ─────────────────────────────────

export async function setValidationModeAction(
  tenantId: string,
  mode: "auto" | "manual" | "skip" | null,
) {
  return adminAction(async () => {
    const { userId } = await requireSuperAdmin();
    const parsed = setModeSchema.safeParse({ tenantId, mode });
    if (!parsed.success) throw new Error(`VALIDATION: ${parsed.error.message}`);

    const t = await assertTenantExists(parsed.data.tenantId);

    await db
      .update(agentConfigs)
      .set({ validationMode: parsed.data.mode, updatedAt: new Date() })
      .where(eq(agentConfigs.tenantId, parsed.data.tenantId));

    await db.insert(auditLog).values({
      tenantId: parsed.data.tenantId,
      userId,
      action: "admin_validator_set_mode",
      entity: "agent_configs",
      entityId: parsed.data.tenantId,
      metadata: { mode: parsed.data.mode, slug: t.slug },
    });

    revalidatePath(`/admin/tenants/${parsed.data.tenantId}`);
    revalidatePath("/admin/tenants");
    revalidatePath("/admin/validator");
    return { tenantId: parsed.data.tenantId, mode: parsed.data.mode };
  });
}

// ─── unpauseAgentAction ──────────────────────────────────────

export async function unpauseAgentAction(tenantId: string) {
  return adminAction(async () => {
    const { userId } = await requireSuperAdmin();
    if (!uuid.safeParse(tenantId).success) throw new Error("VALIDATION: tenantId no es UUID");

    const t = await assertTenantExists(tenantId);

    await db
      .update(agentConfigs)
      .set({ paused: false, updatedAt: new Date() })
      .where(eq(agentConfigs.tenantId, tenantId));

    await db.insert(auditLog).values({
      tenantId,
      userId,
      action: "admin_validator_unpause_agent",
      entity: "agent_configs",
      entityId: tenantId,
      metadata: { slug: t.slug },
    });

    revalidatePath(`/admin/tenants/${tenantId}`);
    revalidatePath("/admin/tenants");
    return { tenantId };
  });
}

// ─── triggerManualRunAction ──────────────────────────────────

export async function triggerManualRunAction(tenantId: string) {
  return adminAction(async () => {
    const { userId } = await requireSuperAdmin();
    if (!uuid.safeParse(tenantId).success) throw new Error("VALIDATION: tenantId no es UUID");

    const t = await assertTenantExists(tenantId);

    // Rate limit: 3 runs manuales por hora por tenant (blueprint §4.2b).
    // Ahorra round-trip si el runtime rechazaría igual.
    const rl = await limitByTenantValidatorManual(tenantId);
    if (!rl.ok) {
      const resetSec = Math.max(0, Math.round((rl.reset - Date.now()) / 1000));
      throw new Error(
        `VALIDATION: límite 3 runs manuales/hora alcanzado. Espera ${resetSec}s.`,
      );
    }

    const runtimeUrl = (process.env.RUNTIME_URL ?? "").replace(/\/$/, "");
    const secret = process.env.RUNTIME_INTERNAL_SECRET ?? "";
    if (!runtimeUrl || !secret) {
      throw new Error("VALIDATION: RUNTIME_URL/RUNTIME_INTERNAL_SECRET ausentes");
    }

    const res = await fetch(`${runtimeUrl}/internal/validator/run-seeds`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": secret,
      },
      body: JSON.stringify({
        tenant_id: tenantId,
        triggered_by: "admin_manual",
      }),
      signal: AbortSignal.timeout(10_000),
    }).catch((e) => {
      throw new Error(`INTERNAL: runtime unreachable: ${e instanceof Error ? e.message : e}`);
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`INTERNAL: runtime HTTP ${res.status}: ${body.slice(0, 200)}`);
    }

    await db.insert(auditLog).values({
      tenantId,
      userId,
      action: "admin_validator_manual_run",
      entity: "validator_runs",
      entityId: tenantId,
      metadata: { slug: t.slug, triggeredBy: "admin_manual" },
    });

    revalidatePath(`/admin/tenants/${tenantId}`);
    revalidatePath("/admin/validator");
    return { tenantId, triggered: true };
  });
}
