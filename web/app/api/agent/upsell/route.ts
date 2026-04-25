// web/app/api/agent/upsell/route.ts — Mig 046.
// GET → devuelve la config upsell del tenant.
// PATCH → actualiza los flags. El runtime brain los lee en el siguiente turno.

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { agentConfigs } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";

const patchSchema = z.object({
  suggestStarterWithMain: z.boolean().optional(),
  suggestDessertAtClose: z.boolean().optional(),
  suggestPairing: z.boolean().optional(),
});

const DEFAULT_CFG = {
  suggestStarterWithMain: false,
  suggestDessertAtClose: false,
  suggestPairing: false,
};

export async function GET() {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const [row] = await db
    .select({ upsellConfig: agentConfigs.upsellConfig })
    .from(agentConfigs)
    .where(eq(agentConfigs.tenantId, bundle.tenant.id))
    .limit(1);

  return NextResponse.json({ upsellConfig: row?.upsellConfig ?? DEFAULT_CFG });
}

export async function PATCH(req: Request) {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_input", issues: parsed.error.flatten() }, { status: 400 });
  }

  // Merge con la config existente para permitir updates parciales sin pisar flags.
  const [current] = await db
    .select({ upsellConfig: agentConfigs.upsellConfig })
    .from(agentConfigs)
    .where(eq(agentConfigs.tenantId, bundle.tenant.id))
    .limit(1);

  const merged = { ...(current?.upsellConfig ?? DEFAULT_CFG), ...parsed.data };

  const [updated] = await db
    .update(agentConfigs)
    .set({ upsellConfig: merged, updatedAt: new Date() })
    .where(eq(agentConfigs.tenantId, bundle.tenant.id))
    .returning({ upsellConfig: agentConfigs.upsellConfig });

  if (!updated) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true, upsellConfig: updated.upsellConfig });
}
