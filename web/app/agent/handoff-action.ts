"use server";

import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";

// Permite número con o sin +, validamos solo dígitos + longitud razonable.
const phoneSchema = z
  .string()
  .trim()
  .max(20)
  .regex(/^\+?[0-9]{6,18}$|^$/, "Debe ser solo dígitos (6-18) con o sin +, o vacío");

export async function setHandoffPhoneAction(rawPhone: string) {
  const session = await auth();
  const bundle = await requireTenant();
  if (!session?.user?.id || !bundle) {
    return { ok: false as const, error: "no_tenant" };
  }
  const parsed = phoneSchema.safeParse(rawPhone);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? "phone_invalido" };
  }
  // Normalizamos a dígitos puros (Evolution acepta sin +).
  const normalized = parsed.data.replace(/^\+/, "").trim();
  const value: string | null = normalized.length === 0 ? null : normalized;

  await db.execute(sql`
    UPDATE agent_configs
    SET handoff_whatsapp_phone = ${value}, updated_at = NOW()
    WHERE tenant_id = ${bundle.tenant.id}::uuid
  `);

  await db.insert(auditLog).values({
    tenantId: bundle.tenant.id,
    userId: session.user.id,
    action: "tenant_set_handoff_phone",
    entity: "agent_configs",
    entityId: bundle.tenant.id,
    metadata: { has_phone: value != null, phone_tail: value ? value.slice(-4) : null },
  });

  revalidatePath("/agent");
  return { ok: true as const, phone: value };
}
