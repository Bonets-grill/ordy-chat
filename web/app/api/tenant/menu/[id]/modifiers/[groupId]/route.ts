// web/app/api/tenant/menu/[id]/modifiers/[groupId]/route.ts
//
// PATCH  → editar el grupo (nombre, tipo, required, min/max, sortOrder).
// DELETE → borrar el grupo (cascade a sus modifiers vía FK).
//
// Multi-tenant: tenant_id obligatorio en cada query. groupId solo se acepta si
// pertenece al tenant Y al menu_item de la URL.

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { menuItemModifierGroups } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";

const groupPatchSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    selectionType: z.enum(["single", "multi"]).optional(),
    required: z.boolean().optional(),
    minSelect: z.number().int().min(0).max(20).optional(),
    maxSelect: z.number().int().min(1).max(20).nullable().optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "empty_patch" });

type Ctx = { params: Promise<{ id: string; groupId: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id, groupId } = await ctx.params;

  const parsed = groupPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_input", issues: parsed.error.flatten() }, { status: 400 });
  }

  const data: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() };

  // Si se cambia a single, forzar maxSelect=1 para coherencia con el CHECK DB.
  if (parsed.data.selectionType === "single") {
    data.maxSelect = 1;
  }

  const [updated] = await db
    .update(menuItemModifierGroups)
    .set(data)
    .where(
      and(
        eq(menuItemModifierGroups.id, groupId),
        eq(menuItemModifierGroups.menuItemId, id),
        eq(menuItemModifierGroups.tenantId, bundle.tenant.id),
      ),
    )
    .returning();

  if (!updated) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true, group: updated });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id, groupId } = await ctx.params;

  const res = await db
    .delete(menuItemModifierGroups)
    .where(
      and(
        eq(menuItemModifierGroups.id, groupId),
        eq(menuItemModifierGroups.menuItemId, id),
        eq(menuItemModifierGroups.tenantId, bundle.tenant.id),
      ),
    )
    .returning({ id: menuItemModifierGroups.id });

  if (res.length === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
