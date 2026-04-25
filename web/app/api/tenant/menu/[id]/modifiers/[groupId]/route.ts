// web/app/api/tenant/menu/[id]/modifiers/[groupId]/route.ts
//
// PATCH  → actualiza metadatos del LINK entre este producto y el grupo
//          (sortOrder, dependsOnOptionId). NO toca el grupo biblioteca: para
//          eso usar /api/tenant/modifier-groups/[groupId].
// DELETE → desvincula el grupo de este producto (borra fila de
//          menu_item_modifier_group_links, no borra el grupo).
//
// Multi-tenant: ownership validado por join con menuItems + modifierGroups.

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  menuItemModifierGroupLinks,
  menuItems,
  modifierGroups,
  modifierOptions,
} from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";

const linkPatchSchema = z
  .object({
    sortOrder: z.number().int().min(0).max(10_000).optional(),
    dependsOnOptionId: z.string().uuid().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "empty_patch" });

type Ctx = { params: Promise<{ id: string; groupId: string }> };

async function ensureLink(tenantId: string, itemId: string, groupId: string) {
  const [row] = await db
    .select({
      linkId: menuItemModifierGroupLinks.id,
    })
    .from(menuItemModifierGroupLinks)
    .innerJoin(menuItems, eq(menuItems.id, menuItemModifierGroupLinks.menuItemId))
    .innerJoin(modifierGroups, eq(modifierGroups.id, menuItemModifierGroupLinks.groupId))
    .where(
      and(
        eq(menuItemModifierGroupLinks.menuItemId, itemId),
        eq(menuItemModifierGroupLinks.groupId, groupId),
        eq(menuItems.tenantId, tenantId),
        eq(modifierGroups.tenantId, tenantId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function PATCH(req: Request, ctx: Ctx) {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id, groupId } = await ctx.params;

  const link = await ensureLink(bundle.tenant.id, id, groupId);
  if (!link) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const parsed = linkPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_input", issues: parsed.error.flatten() }, { status: 400 });
  }
  const patch = parsed.data;

  // Si dependsOnOptionId != null, debe pertenecer a una opción de OTRO grupo
  // del MISMO tenant (la dependencia cruza grupos pero no tenants).
  if (patch.dependsOnOptionId) {
    const [opt] = await db
      .select({ groupId: modifierOptions.groupId, tenantId: modifierGroups.tenantId })
      .from(modifierOptions)
      .innerJoin(modifierGroups, eq(modifierGroups.id, modifierOptions.groupId))
      .where(eq(modifierOptions.id, patch.dependsOnOptionId))
      .limit(1);
    if (!opt || opt.tenantId !== bundle.tenant.id) {
      return NextResponse.json({ error: "depends_on_invalid" }, { status: 400 });
    }
    if (opt.groupId === groupId) {
      return NextResponse.json({ error: "depends_on_same_group" }, { status: 400 });
    }
  }

  const [updated] = await db
    .update(menuItemModifierGroupLinks)
    .set(patch)
    .where(eq(menuItemModifierGroupLinks.id, link.linkId))
    .returning();

  return NextResponse.json({ link: updated });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id, groupId } = await ctx.params;

  const link = await ensureLink(bundle.tenant.id, id, groupId);
  if (!link) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await db.delete(menuItemModifierGroupLinks).where(eq(menuItemModifierGroupLinks.id, link.linkId));
  return NextResponse.json({ ok: true });
}
