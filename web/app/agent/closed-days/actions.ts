"use server";

// web/app/agent/closed-days/actions.ts — Server action para setear fechas
// cerradas del tenant actual. requireTenant + Zod + audit_log + revalidatePath.
// Solo exporta async functions (guard check-use-server.mjs).

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { agentConfigs, auditLog } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";
import {
  CLOSED_DAYS_DATE_RE,
  CLOSED_DAYS_MAX,
  normalizeClosedDays,
} from "@/lib/agent/closed-days";

type ActionResult =
  | { ok: true; dates: string[] }
  | { ok: false; error: string; code: "UNAUTHENTICATED" | "NO_TENANT" | "VALIDATION" | "INTERNAL" };

const setSchema = z.object({
  dates: z.array(z.string().regex(CLOSED_DAYS_DATE_RE)).max(CLOSED_DAYS_MAX),
});

export async function setClosedDaysAction(
  rawInput: { dates: unknown },
): Promise<ActionResult> {
  try {
    const bundle = await requireTenant();
    if (!bundle) {
      return { ok: false, error: "No hay tenant para el usuario actual.", code: "NO_TENANT" };
    }

    const parsed = setSchema.safeParse(rawInput);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.message, code: "VALIDATION" };
    }

    const before = bundle.config?.reservationsClosedFor ?? [];
    const after = normalizeClosedDays(parsed.data.dates, bundle.tenant.timezone);

    await db
      .update(agentConfigs)
      .set({ reservationsClosedFor: after, updatedAt: new Date() })
      .where(eq(agentConfigs.tenantId, bundle.tenant.id));

    await db.insert(auditLog).values({
      tenantId: bundle.tenant.id,
      action: "agent_config.update_closed_days",
      entity: "agent_configs",
      entityId: bundle.tenant.id,
      metadata: { before, after },
    });

    revalidatePath("/agent");
    revalidatePath("/agent/closed-days");

    return { ok: true, dates: after };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "internal";
    return { ok: false, error: msg, code: "INTERNAL" };
  }
}
