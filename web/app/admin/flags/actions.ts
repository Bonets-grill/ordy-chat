"use server";

// web/app/admin/flags/actions.ts — Server action para setear un flag.
// Gate super admin + Zod + audit_log + revalidatePath.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";
import { adminAction, requireSuperAdmin } from "@/lib/admin/auth";
import { FLAG_SPECS, type FlagKey, setFlag } from "@/lib/admin/flags";

const FLAG_KEY_ENUM = z.enum(FLAG_SPECS.map((s) => s.key) as [FlagKey, ...FlagKey[]]);

const setFlagSchema = z.object({
  key: FLAG_KEY_ENUM,
  value: z.unknown(),
});

export async function setFlagAction(
  rawInput: { key: string; value: unknown },
): Promise<
  | { ok: true; data: { key: FlagKey; value: unknown } }
  | { ok: false; error: string; code: "UNAUTHENTICATED" | "FORBIDDEN" | "VALIDATION" | "INTERNAL" }
> {
  return adminAction(async () => {
    const { userId } = await requireSuperAdmin();

    const parsed = setFlagSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new Error(`VALIDATION: ${parsed.error.message}`);
    }
    const { key, value } = parsed.data;

    await setFlag(key, value, userId);

    await db.insert(auditLog).values({
      userId,
      action: "admin_set_flag",
      entity: "platform_settings",
      entityId: `flag.${key}`,
      metadata: { key, value },
    });

    revalidatePath("/admin/flags");
    revalidatePath("/admin");
    return { key, value };
  });
}
