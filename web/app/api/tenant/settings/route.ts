// PATCH /api/tenant/settings — actualiza ajustes operativos del tenant.
//
// 2026-04-26: por ahora solo `timezone`. La lista de IANA TZ se valida con un
// allowlist (TIMEZONES en lib/timezones.ts) — no aceptamos texto libre porque
// luego se inyecta en SQL `AT TIME ZONE` y un valor inválido rompería todos
// los reportes de ventas y el cron auto-open-shifts.
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { tenants } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";
import { TIMEZONE_VALUES } from "@/lib/timezones";

export const runtime = "nodejs";

const bodySchema = z.object({
  timezone: z.string().refine((v) => (TIMEZONE_VALUES as readonly string[]).includes(v), {
    message: "timezone no soportada",
  }),
});

export async function PATCH(req: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "no_tenant" }, { status: 404 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_input", issues: parsed.error.flatten() }, { status: 400 });
  }

  const [updated] = await db
    .update(tenants)
    .set({ timezone: parsed.data.timezone, updatedAt: new Date() })
    .where(eq(tenants.id, bundle.tenant.id))
    .returning({ id: tenants.id, timezone: tenants.timezone });

  return NextResponse.json({ ok: true, tenant: updated });
}
