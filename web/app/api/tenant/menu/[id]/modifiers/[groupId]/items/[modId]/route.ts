// web/app/api/tenant/menu/[id]/modifiers/[groupId]/items/[modId]/route.ts
//
// PATCH  → editar un modifier (nombre, delta, available, sort).
// DELETE → borrar un modifier (no afecta a snapshots ya guardados en orders).
//
// Multi-tenant: validamos que el modifier pertenece al grupo, el grupo al
// item, y el item al tenant. Triple ownership en cada operación.

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { menuItemModifierGroups, menuItemModifiers } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";

const modifierPatchSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    priceDeltaCents: z.number().int().min(0).max(100_000).optional(),
    available: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "empty_patch" });

type Ctx = { params: Promise<{ id: string; groupId: string; modId: string }> };

// Helper: valida que el modifier pertenece al grupo correcto, que el grupo
// pertenece al item, y que ambos al tenant. Devuelve el id del modifier o null.
async function checkOwnership(
  modId: string,
  groupId: string,
  itemId: string,
  tenantId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ modId: menuItemModifiers.id })
    .from(menuItemModifiers)
    .innerJoin(
      menuItemModifierGroups,
      eq(menuItemModifiers.groupId, menuItemModifierGroups.id),
    )
    .where(
      and(
        eq(menuItemModifiers.id, modId),
        eq(menuItemModifierGroups.id, groupId),
        eq(menuItemModifierGroups.menuItemId, itemId),
        eq(menuItemModifierGroups.tenantId, tenantId),
      ),
    )
    .limit(1);
  return row?.modId ?? null;
}

export async function PATCH(req: Request, ctx: Ctx) {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id, groupId, modId } = await ctx.params;

  const parsed = modifierPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_input", issues: parsed.error.flatten() }, { status: 400 });
  }

  const owned = await checkOwnership(modId, groupId, id, bundle.tenant.id);
  if (!owned) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const [updated] = await db
    .update(menuItemModifiers)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(menuItemModifiers.id, modId))
    .returning();

  return NextResponse.json({ ok: true, modifier: updated });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id, groupId, modId } = await ctx.params;

  const owned = await checkOwnership(modId, groupId, id, bundle.tenant.id);
  if (!owned) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await db.delete(menuItemModifiers).where(eq(menuItemModifiers.id, modId));
  return NextResponse.json({ ok: true });
}
