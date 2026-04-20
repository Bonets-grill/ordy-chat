"use server";

// web/app/admin/instances/actions.ts — Unburn + warmup override por tenant.

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { adminAction, requireSuperAdmin } from "@/lib/admin/auth";
import { db } from "@/lib/db";
import { auditLog, providerCredentials } from "@/lib/db/schema";

const uuidSchema = z.string().uuid();

export async function unburnInstanceAction(tenantId: string) {
  return adminAction(async () => {
    const { userId } = await requireSuperAdmin();
    const parsed = uuidSchema.safeParse(tenantId);
    if (!parsed.success) throw new Error("VALIDATION: tenantId no es UUID");

    const [pc] = await db
      .select({
        tenantId: providerCredentials.tenantId,
        burned: providerCredentials.burned,
        burnedReason: providerCredentials.burnedReason,
      })
      .from(providerCredentials)
      .where(eq(providerCredentials.tenantId, parsed.data))
      .limit(1);
    if (!pc) throw new Error("VALIDATION: instancia no existe");
    if (!pc.burned) throw new Error("VALIDATION: instancia no está burned");

    await db
      .update(providerCredentials)
      .set({
        burned: false,
        burnedAt: null,
        burnedReason: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(providerCredentials.tenantId, parsed.data),
          eq(providerCredentials.burned, true),
        ),
      );

    await db.insert(auditLog).values({
      userId,
      action: "admin_unburn_instance",
      entity: "provider_credentials",
      entityId: parsed.data,
      metadata: { previous_reason: pc.burnedReason },
    });

    revalidatePath("/admin/instances");
    revalidatePath("/admin");
    return { tenantId: parsed.data };
  });
}


const overrideSchema = z.object({
  tenantId: z.string().uuid(),
  enable: z.boolean(),
  reason: z.string().trim().min(5, "Razón mínima 5 chars").max(500).optional(),
});

export async function toggleWarmupOverrideAction(input: {
  tenantId: string;
  enable: boolean;
  reason?: string;
}) {
  return adminAction(async () => {
    const { userId } = await requireSuperAdmin();
    const parsed = overrideSchema.safeParse(input);
    if (!parsed.success) {
      throw new Error(`VALIDATION: ${parsed.error.issues[0]?.message ?? "input inválido"}`);
    }
    const { tenantId, enable, reason } = parsed.data;

    // Requerir reason SOLO al activar el override (es la acción auditable).
    // Desactivar no requiere razón.
    if (enable && !reason) {
      throw new Error("VALIDATION: razón obligatoria al activar warmup_override");
    }

    const [pc] = await db
      .select({
        tenantId: providerCredentials.tenantId,
        current: providerCredentials.warmupOverride,
      })
      .from(providerCredentials)
      .where(eq(providerCredentials.tenantId, tenantId))
      .limit(1);
    if (!pc) throw new Error("VALIDATION: instancia no existe");
    if (pc.current === enable) {
      throw new Error(`VALIDATION: warmup_override ya está ${enable ? "activo" : "inactivo"}`);
    }

    await db
      .update(providerCredentials)
      .set({
        warmupOverride: enable,
        warmupOverrideReason: enable ? reason ?? null : null,
        warmupOverrideBy: enable ? userId : null,
        warmupOverrideAt: enable ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(providerCredentials.tenantId, tenantId));

    await db.insert(auditLog).values({
      userId,
      action: enable ? "admin_warmup_override_on" : "admin_warmup_override_off",
      entity: "provider_credentials",
      entityId: tenantId,
      metadata: enable ? { reason } : {},
    });

    revalidatePath("/admin/instances");
    revalidatePath("/admin");
    return { tenantId, enable };
  });
}
