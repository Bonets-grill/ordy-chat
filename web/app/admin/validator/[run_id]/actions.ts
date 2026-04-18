"use server";

// web/app/admin/validator/[run_id]/actions.ts
//
// Sprint 3 validador-ui · Fase 3 (message actions) + Fase 4 (run actions).
// Las acciones de F4 se APPEND-an a este archivo en F4. Este commit SOLO F3.
//
// Patrón estándar:
//   1. requireSuperAdmin() como primera línea dentro de adminAction().
//   2. Zod para UUIDs + payload.
//   3. Mutación en DB usando drizzle (RLS bypass vía permisos neon).
//   4. INSERT audit_log con action='admin_validator_<verb>'.
//   5. revalidatePath del detalle + lista.

import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { adminAction, requireSuperAdmin } from "@/lib/admin/auth";
import { db } from "@/lib/db";
import {
  agentConfigs,
  auditLog,
  validatorMessages,
  validatorRuns,
} from "@/lib/db/schema";

const uuid = z.string().uuid();

const rejectSchema = z.object({
  runId: uuid,
  messageId: uuid,
  reason: z.string().trim().max(500).optional(),
});

const editSchema = z.object({
  runId: uuid,
  messageId: uuid,
  newResponse: z.string().trim().min(1).max(4000),
});

// ─── Helpers ─────────────────────────────────────────────────

async function assertMessageBelongsToRun(runId: string, messageId: string) {
  const [m] = await db
    .select({
      id: validatorMessages.id,
      runId: validatorMessages.runId,
      adminDecision: validatorMessages.adminDecision,
    })
    .from(validatorMessages)
    .where(and(eq(validatorMessages.id, messageId), eq(validatorMessages.runId, runId)))
    .limit(1);
  if (!m) {
    throw new Error("VALIDATION: message no pertenece a run");
  }
  return m;
}

async function assertRunExists(runId: string) {
  const [r] = await db
    .select({ id: validatorRuns.id, tenantId: validatorRuns.tenantId, status: validatorRuns.status })
    .from(validatorRuns)
    .where(eq(validatorRuns.id, runId))
    .limit(1);
  if (!r) {
    throw new Error("VALIDATION: run no existe");
  }
  return r;
}

// ─── Fase 3: approve message ─────────────────────────────────

export async function approveMessageAction(runId: string, messageId: string) {
  return adminAction(async () => {
    const { userId } = await requireSuperAdmin();
    if (!uuid.safeParse(runId).success) throw new Error("VALIDATION: runId no es UUID");
    if (!uuid.safeParse(messageId).success) throw new Error("VALIDATION: messageId no es UUID");

    await assertRunExists(runId);
    const m = await assertMessageBelongsToRun(runId, messageId);
    if (m.adminDecision !== null) {
      throw new Error("VALIDATION: mensaje ya tiene decisión previa");
    }

    await db
      .update(validatorMessages)
      .set({
        adminDecision: "approved",
        adminDecidedAt: new Date(),
        adminDecidedBy: userId,
      })
      .where(
        and(
          eq(validatorMessages.id, messageId),
          isNull(validatorMessages.adminDecision),
        ),
      );

    await db.insert(auditLog).values({
      userId,
      action: "admin_validator_message_approve",
      entity: "validator_messages",
      entityId: messageId,
      metadata: { runId },
    });

    revalidatePath(`/admin/validator/${runId}`);
    revalidatePath("/admin/validator");
    return { runId, messageId, decision: "approved" as const };
  });
}

// ─── Fase 3: reject message ──────────────────────────────────

export async function rejectMessageAction(
  runId: string,
  messageId: string,
  reason?: string,
) {
  return adminAction(async () => {
    const { userId } = await requireSuperAdmin();
    const parsed = rejectSchema.safeParse({ runId, messageId, reason });
    if (!parsed.success) throw new Error(`VALIDATION: ${parsed.error.message}`);

    await assertRunExists(parsed.data.runId);
    const m = await assertMessageBelongsToRun(parsed.data.runId, parsed.data.messageId);
    if (m.adminDecision !== null) {
      throw new Error("VALIDATION: mensaje ya tiene decisión previa");
    }

    await db
      .update(validatorMessages)
      .set({
        adminDecision: "rejected",
        adminDecidedAt: new Date(),
        adminDecidedBy: userId,
      })
      .where(
        and(
          eq(validatorMessages.id, parsed.data.messageId),
          isNull(validatorMessages.adminDecision),
        ),
      );

    await db.insert(auditLog).values({
      userId,
      action: "admin_validator_message_reject",
      entity: "validator_messages",
      entityId: parsed.data.messageId,
      metadata: { runId: parsed.data.runId, reason: parsed.data.reason ?? null },
    });

    revalidatePath(`/admin/validator/${parsed.data.runId}`);
    revalidatePath("/admin/validator");
    return { runId: parsed.data.runId, messageId: parsed.data.messageId, decision: "rejected" as const };
  });
}

// ─── Fase 3: edit message response ──────────────────────────

export async function editMessageResponseAction(
  runId: string,
  messageId: string,
  newResponse: string,
) {
  return adminAction(async () => {
    const { userId } = await requireSuperAdmin();
    const parsed = editSchema.safeParse({ runId, messageId, newResponse });
    if (!parsed.success) throw new Error(`VALIDATION: ${parsed.error.message}`);

    await assertRunExists(parsed.data.runId);
    const m = await assertMessageBelongsToRun(parsed.data.runId, parsed.data.messageId);
    if (m.adminDecision !== null) {
      throw new Error("VALIDATION: mensaje ya tiene decisión previa");
    }

    await db
      .update(validatorMessages)
      .set({
        adminDecision: "edited",
        adminDecidedAt: new Date(),
        adminDecidedBy: userId,
        adminEditedResponse: parsed.data.newResponse,
      })
      .where(
        and(
          eq(validatorMessages.id, parsed.data.messageId),
          isNull(validatorMessages.adminDecision),
        ),
      );

    await db.insert(auditLog).values({
      userId,
      action: "admin_validator_message_edit",
      entity: "validator_messages",
      entityId: parsed.data.messageId,
      metadata: {
        runId: parsed.data.runId,
        newResponseLen: parsed.data.newResponse.length,
      },
    });

    revalidatePath(`/admin/validator/${parsed.data.runId}`);
    revalidatePath("/admin/validator");
    return {
      runId: parsed.data.runId,
      messageId: parsed.data.messageId,
      decision: "edited" as const,
    };
  });
}

// ═══════════════════════════════════════════════════════════════
// Fase 4: Run-level actions
// ═══════════════════════════════════════════════════════════════

const rejectRunSchema = z.object({
  runId: uuid,
  reason: z.string().trim().min(1).max(500),
});

/**
 * approveRunAction: marca todos los messages pendientes del run como
 * approved y — SOLO si todos los messages quedan approved/edited y el run
 * está en pass|review — levanta el paused del agente.
 *
 * Guard de unpause (blueprint §4.2):
 *   (a) ningún message con admin_decision='rejected' ni NULL
 *   (b) run.status ∈ {'pass','review'} (nunca desde 'fail')
 */
export async function approveRunAction(runId: string) {
  return adminAction(async () => {
    const { userId } = await requireSuperAdmin();
    if (!uuid.safeParse(runId).success) throw new Error("VALIDATION: runId no es UUID");

    const run = await assertRunExists(runId);

    // Marca todos los messages sin decisión como approved.
    await db
      .update(validatorMessages)
      .set({
        adminDecision: "approved",
        adminDecidedAt: new Date(),
        adminDecidedBy: userId,
      })
      .where(
        and(
          eq(validatorMessages.runId, runId),
          isNull(validatorMessages.adminDecision),
        ),
      );

    // Verifica guard de unpause.
    const [counts] = await db
      .select({
        total: sql<number>`count(*)::int`,
        rejected: sql<number>`count(*) filter (where admin_decision = 'rejected')::int`,
        pending: sql<number>`count(*) filter (where admin_decision is null)::int`,
      })
      .from(validatorMessages)
      .where(eq(validatorMessages.runId, runId));

    const allDecided = Number(counts?.pending ?? 0) === 0;
    const noneRejected = Number(counts?.rejected ?? 0) === 0;
    const runOk = run.status === "pass" || run.status === "review";
    const shouldUnpause = allDecided && noneRejected && runOk;

    if (shouldUnpause) {
      await db
        .update(agentConfigs)
        .set({ paused: false, updatedAt: new Date() })
        .where(eq(agentConfigs.tenantId, run.tenantId));
    }

    await db.insert(auditLog).values({
      tenantId: run.tenantId,
      userId,
      action: "admin_validator_run_approve",
      entity: "validator_runs",
      entityId: runId,
      metadata: {
        runStatus: run.status,
        total: Number(counts?.total ?? 0),
        rejected: Number(counts?.rejected ?? 0),
        unpaused: shouldUnpause,
      },
    });

    revalidatePath(`/admin/validator/${runId}`);
    revalidatePath("/admin/validator");
    revalidatePath(`/admin/tenants/${run.tenantId}`);
    return { runId, unpaused: shouldUnpause };
  });
}

/**
 * rejectRunAction: marca todos los messages pendientes como rejected.
 * NO modifica agent_configs.paused (el agente queda pausado).
 */
export async function rejectRunAction(runId: string, reason: string) {
  return adminAction(async () => {
    const { userId } = await requireSuperAdmin();
    const parsed = rejectRunSchema.safeParse({ runId, reason });
    if (!parsed.success) throw new Error(`VALIDATION: ${parsed.error.message}`);

    const run = await assertRunExists(parsed.data.runId);

    await db
      .update(validatorMessages)
      .set({
        adminDecision: "rejected",
        adminDecidedAt: new Date(),
        adminDecidedBy: userId,
      })
      .where(
        and(
          eq(validatorMessages.runId, parsed.data.runId),
          isNull(validatorMessages.adminDecision),
        ),
      );

    await db.insert(auditLog).values({
      tenantId: run.tenantId,
      userId,
      action: "admin_validator_run_reject",
      entity: "validator_runs",
      entityId: parsed.data.runId,
      metadata: { reason: parsed.data.reason, runStatus: run.status },
    });

    revalidatePath(`/admin/validator/${parsed.data.runId}`);
    revalidatePath("/admin/validator");
    return { runId: parsed.data.runId };
  });
}

/**
 * triggerManualAutopatchAction: dispara un autopatch_retry desde el admin.
 * Llama al runtime POST /internal/validator/run-seeds con
 * triggered_by='admin_manual' y x-internal-secret (timingSafeEqual en el
 * runtime, patrón heredado Sprint 2 F8).
 */
export async function triggerManualAutopatchAction(runId: string) {
  return adminAction(async () => {
    const { userId } = await requireSuperAdmin();
    if (!uuid.safeParse(runId).success) throw new Error("VALIDATION: runId no es UUID");

    const run = await assertRunExists(runId);

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
        tenant_id: run.tenantId,
        triggered_by: "admin_manual",
        previous_run_id: runId,
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
      tenantId: run.tenantId,
      userId,
      action: "admin_validator_manual_autopatch",
      entity: "validator_runs",
      entityId: runId,
      metadata: { previousRunId: runId },
    });

    revalidatePath(`/admin/validator/${runId}`);
    revalidatePath("/admin/validator");
    return { runId, triggered: true };
  });
}

/**
 * rollbackAutopatchAction: restaura el system_prompt anterior al autopatch.
 * Todo envuelto en db.transaction (patrón blueprint §4.2).
 */
export async function rollbackAutopatchAction(runId: string) {
  return adminAction(async () => {
    const { userId } = await requireSuperAdmin();
    if (!uuid.safeParse(runId).success) throw new Error("VALIDATION: runId no es UUID");

    // neon-http soporta transaction via HTTP; drizzle la expone.
    const result = await db.transaction(async (tx) => {
      const [r] = await tx
        .select({
          id: validatorRuns.id,
          tenantId: validatorRuns.tenantId,
          previousSystemPrompt: validatorRuns.previousSystemPrompt,
          autopatchAppliedAt: validatorRuns.autopatchAppliedAt,
        })
        .from(validatorRuns)
        .where(eq(validatorRuns.id, runId))
        .limit(1);

      if (!r) throw new Error("VALIDATION: run no existe");
      if (!r.previousSystemPrompt) {
        throw new Error("VALIDATION: run no tiene previous_system_prompt (no hubo autopatch)");
      }

      await tx
        .update(agentConfigs)
        .set({ systemPrompt: r.previousSystemPrompt, updatedAt: new Date() })
        .where(eq(agentConfigs.tenantId, r.tenantId));

      await tx.insert(auditLog).values({
        tenantId: r.tenantId,
        userId,
        action: "admin_validator_autopatch_rollback",
        entity: "validator_runs",
        entityId: runId,
        metadata: {
          previousAppliedAt: r.autopatchAppliedAt?.toISOString() ?? null,
        },
      });

      return { tenantId: r.tenantId };
    });

    revalidatePath(`/admin/validator/${runId}`);
    revalidatePath("/admin/validator");
    revalidatePath(`/admin/tenants/${result.tenantId}`);
    return { runId, rolledBack: true };
  });
}
