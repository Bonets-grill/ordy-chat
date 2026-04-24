// PATCH /api/agent/pos-reports
// Mig 040. Actualiza la lista de teléfonos WA que reciben los reportes POS
// automáticos (turno auto-abierto, cierre manual, resumen diario).
//
// Validación: cada entrada solo dígitos o '+', longitud 6-18 (coincide con
// la validación del handoff_whatsapp_phone existente). Normalizamos a dígitos
// puros antes de persistir — Evolution acepta sin '+'.

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { agentConfigs, auditLog } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";

const phoneSchema = z
  .string()
  .trim()
  .max(20)
  .regex(/^\+?[0-9]{6,18}$/, "solo dígitos (6-18), con o sin +");

const bodySchema = z.object({
  phones: z.array(phoneSchema).max(10),
});

export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauth" }, { status: 401 });
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "no_tenant" }, { status: 404 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_input", issues: parsed.error.flatten() }, { status: 400 });
  }

  // Normalización: dígitos puros, trim, dedupe, filtro vacíos.
  const normalized = Array.from(
    new Set(
      parsed.data.phones
        .map((p) => p.replace(/^\+/, "").trim())
        .filter((p) => p.length >= 6),
    ),
  );

  await db
    .update(agentConfigs)
    .set({ posReportPhones: normalized, updatedAt: new Date() })
    .where(eq(agentConfigs.tenantId, bundle.tenant.id));

  await db.insert(auditLog).values({
    tenantId: bundle.tenant.id,
    userId: session.user.id,
    action: "tenant_set_pos_report_phones",
    entity: "agent_configs",
    entityId: bundle.tenant.id,
    metadata: {
      count: normalized.length,
      tails: normalized.map((p) => p.slice(-4)),
    },
  });

  return NextResponse.json({ ok: true, phones: normalized });
}
