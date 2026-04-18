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

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { adminAction, requireSuperAdmin } from "@/lib/admin/auth";
import { db } from "@/lib/db";
import { auditLog, validatorMessages, validatorRuns } from "@/lib/db/schema";

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
