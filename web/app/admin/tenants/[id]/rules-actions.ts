"use server";

// web/app/admin/tenants/[id]/rules-actions.ts
// Server actions para gestionar agent_rules (reglas duras del agente).
// Migración 021 aplicada. El bot cliente las lee en _build_agent_rules_block
// en brain.py y las respeta como no-negociables.

import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { adminAction, requireSuperAdmin } from "@/lib/admin/auth";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";

const uuid = z.string().uuid();

const addRuleSchema = z.object({
  tenantId: uuid,
  ruleText: z.string().min(3).max(500),
  priority: z.number().int().min(0).max(100).default(0),
});

const removeRuleSchema = z.object({
  tenantId: uuid,
  ruleId: uuid,
});

export async function addRuleAction(
  tenantId: string,
  ruleText: string,
  priority: number,
) {
  return adminAction(async () => {
    const { userId } = await requireSuperAdmin();
    const parsed = addRuleSchema.safeParse({ tenantId, ruleText, priority });
    if (!parsed.success) {
      throw new Error(`VALIDATION: ${parsed.error.issues.map((i) => i.message).join(", ")}`);
    }
    const row = await db.execute(
      sql`INSERT INTO agent_rules (tenant_id, rule_text, priority, created_by_user_id)
          VALUES (${parsed.data.tenantId}::uuid,
                  ${parsed.data.ruleText},
                  ${parsed.data.priority},
                  ${userId}::uuid)
          RETURNING id`,
    );
    const inserted = Array.isArray(row) ? row[0] : (row as { rows?: unknown[] }).rows?.[0];
    const ruleId = (inserted as { id?: string } | undefined)?.id ?? null;

    await db.insert(auditLog).values({
      tenantId: parsed.data.tenantId,
      userId,
      action: "super_admin_add_agent_rule",
      entity: "agent_rules",
      entityId: ruleId,
      metadata: {
        rule_text_preview: parsed.data.ruleText.slice(0, 160),
        priority: parsed.data.priority,
      },
    });

    revalidatePath(`/admin/tenants/${parsed.data.tenantId}`);
    return { ok: true as const, ruleId };
  });
}

export async function removeRuleAction(tenantId: string, ruleId: string) {
  return adminAction(async () => {
    const { userId } = await requireSuperAdmin();
    const parsed = removeRuleSchema.safeParse({ tenantId, ruleId });
    if (!parsed.success) throw new Error("VALIDATION: IDs inválidos");

    // Soft delete: active=false conserva historial + permite rollback manual.
    await db.execute(
      sql`UPDATE agent_rules
          SET active = false, updated_at = NOW()
          WHERE id = ${parsed.data.ruleId}::uuid
            AND tenant_id = ${parsed.data.tenantId}::uuid`,
    );

    await db.insert(auditLog).values({
      tenantId: parsed.data.tenantId,
      userId,
      action: "super_admin_remove_agent_rule",
      entity: "agent_rules",
      entityId: parsed.data.ruleId,
      metadata: {},
    });

    revalidatePath(`/admin/tenants/${parsed.data.tenantId}`);
    return { ok: true as const };
  });
}
