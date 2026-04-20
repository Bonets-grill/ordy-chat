"use server";

// web/app/admin/learning/actions.ts
// Acciones super-admin para aprobar/rechazar reglas aprendidas.
// - approveRuleAction: INSERT en agent_rules + status='approved'.
// - rejectRuleAction:  status='rejected'.

import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { adminAction, requireSuperAdmin } from "@/lib/admin/auth";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";

const uuid = z.string().uuid();

export async function approveRuleAction(
  pendingId: string,
  priorityOverride?: number,
) {
  return adminAction(async () => {
    const { userId } = await requireSuperAdmin();
    if (!uuid.safeParse(pendingId).success) {
      throw new Error("VALIDATION: pendingId inválido");
    }

    // Leer la propuesta.
    const pendingRaw = await db.execute(sql`
      SELECT tenant_id::text AS tenant_id, rule_text, suggested_priority, status
      FROM learned_rules_pending
      WHERE id = ${pendingId}::uuid
    `);
    const pendingRow = (Array.isArray(pendingRaw) ? pendingRaw[0] : (pendingRaw as { rows?: unknown[] }).rows?.[0]) as
      | { tenant_id: string; rule_text: string; suggested_priority: number; status: string }
      | undefined;
    if (!pendingRow) throw new Error("VALIDATION: propuesta no encontrada");
    if (pendingRow.status !== "pending") {
      throw new Error(`VALIDATION: ya procesada (status=${pendingRow.status})`);
    }

    const priority =
      priorityOverride != null && priorityOverride >= 0 && priorityOverride <= 100
        ? priorityOverride
        : pendingRow.suggested_priority;

    // Transacción: crea agent_rule + marca pending como approved.
    const inserted = await db.execute(sql`
      INSERT INTO agent_rules (tenant_id, rule_text, priority, created_by_user_id)
      VALUES (${pendingRow.tenant_id}::uuid, ${pendingRow.rule_text}, ${priority}, ${userId}::uuid)
      RETURNING id
    `);
    const newRule = (Array.isArray(inserted) ? inserted[0] : (inserted as { rows?: unknown[] }).rows?.[0]) as
      | { id?: string }
      | undefined;
    const ruleId = newRule?.id ?? null;

    await db.execute(sql`
      UPDATE learned_rules_pending
      SET status = 'approved',
          applied_rule_id = ${ruleId}::uuid,
          reviewed_by_user_id = ${userId}::uuid,
          reviewed_at = now()
      WHERE id = ${pendingId}::uuid
    `);

    await db.insert(auditLog).values({
      tenantId: pendingRow.tenant_id,
      userId,
      action: "super_admin_approve_learned_rule",
      entity: "agent_rules",
      entityId: ruleId,
      metadata: {
        pending_id: pendingId,
        rule_text_preview: pendingRow.rule_text.slice(0, 160),
        priority,
      },
    });

    revalidatePath("/admin/learning");
    revalidatePath(`/admin/tenants/${pendingRow.tenant_id}`);
    return { ok: true as const, ruleId };
  });
}

export async function rejectRuleAction(pendingId: string) {
  return adminAction(async () => {
    const { userId } = await requireSuperAdmin();
    if (!uuid.safeParse(pendingId).success) {
      throw new Error("VALIDATION: pendingId inválido");
    }

    const pendingRaw = await db.execute(sql`
      SELECT tenant_id::text AS tenant_id, status, rule_text
      FROM learned_rules_pending
      WHERE id = ${pendingId}::uuid
    `);
    const pendingRow = (Array.isArray(pendingRaw) ? pendingRaw[0] : (pendingRaw as { rows?: unknown[] }).rows?.[0]) as
      | { tenant_id: string; status: string; rule_text: string }
      | undefined;
    if (!pendingRow) throw new Error("VALIDATION: propuesta no encontrada");

    await db.execute(sql`
      UPDATE learned_rules_pending
      SET status = 'rejected',
          reviewed_by_user_id = ${userId}::uuid,
          reviewed_at = now()
      WHERE id = ${pendingId}::uuid
    `);

    await db.insert(auditLog).values({
      tenantId: pendingRow.tenant_id,
      userId,
      action: "super_admin_reject_learned_rule",
      entity: "learned_rules_pending",
      entityId: pendingId,
      metadata: { rule_text_preview: pendingRow.rule_text.slice(0, 160) },
    });

    revalidatePath("/admin/learning");
    return { ok: true as const };
  });
}
