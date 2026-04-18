"use server";

// web/app/admin/instances/actions.ts — Unburn de instancias Evolution.

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
