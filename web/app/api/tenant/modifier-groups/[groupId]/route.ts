// web/app/api/tenant/modifier-groups/[groupId]/route.ts
//
// PATCH actualiza metadatos del grupo. DELETE borra el grupo (cascade limpia
// opciones y links). Verifica ownership por tenant_id.

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { modifierGroups } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";
import { groupPatchSchema } from "@/lib/modifier-library-schema";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ groupId: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { groupId } = await ctx.params;
  const parsed = groupPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_input", issues: parsed.error.flatten() }, { status: 400 });
  }
  const patch = parsed.data;

  // Si selectionType pasa a single, fuerza maxSelect=1.
  const next: Record<string, unknown> = { ...patch, updatedAt: new Date() };
  if (patch.selectionType === "single") next.maxSelect = 1;

  const [updated] = await db
    .update(modifierGroups)
    .set(next)
    .where(and(eq(modifierGroups.id, groupId), eq(modifierGroups.tenantId, bundle.tenant.id)))
    .returning();

  if (!updated) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ group: updated });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { groupId } = await ctx.params;
  const [deleted] = await db
    .delete(modifierGroups)
    .where(and(eq(modifierGroups.id, groupId), eq(modifierGroups.tenantId, bundle.tenant.id)))
    .returning({ id: modifierGroups.id });

  if (!deleted) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
