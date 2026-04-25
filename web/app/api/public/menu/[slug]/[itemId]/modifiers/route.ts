// web/app/api/public/menu/[slug]/[itemId]/modifiers/route.ts
//
// Endpoint PÚBLICO (sin auth) — usado por el widget /m/[slug] cuando el
// cliente toca "+" en un item para ver/seleccionar sus modificadores.
//
// Lee los grupos asignados al item via menu_item_modifier_group_links + biblioteca
// (mig 051) y solo devuelve opciones con available=true.

import { NextResponse } from "next/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  menuItems,
  menuItemModifierGroupLinks,
  modifierGroups,
  modifierOptions,
  tenants,
} from "@/lib/db/schema";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ slug: string; itemId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug, itemId } = await ctx.params;

  const [t] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1);
  if (!t) return NextResponse.json({ error: "tenant_not_found" }, { status: 404 });

  // El item debe existir y ser del tenant. Sin esto un id arbitrario podría
  // exponer modifiers de otro tenant via slug A + id de B.
  const [item] = await db
    .select({ id: menuItems.id })
    .from(menuItems)
    .where(and(eq(menuItems.id, itemId), eq(menuItems.tenantId, t.id)))
    .limit(1);
  if (!item) return NextResponse.json({ error: "item_not_found" }, { status: 404 });

  const links = await db
    .select({
      sortOrder: menuItemModifierGroupLinks.sortOrder,
      dependsOnOptionId: menuItemModifierGroupLinks.dependsOnOptionId,
      group: modifierGroups,
    })
    .from(menuItemModifierGroupLinks)
    .innerJoin(modifierGroups, eq(modifierGroups.id, menuItemModifierGroupLinks.groupId))
    .where(
      and(
        eq(menuItemModifierGroupLinks.menuItemId, itemId),
        eq(modifierGroups.tenantId, t.id),
      ),
    )
    .orderBy(asc(menuItemModifierGroupLinks.sortOrder), asc(modifierGroups.name));

  if (links.length === 0) return NextResponse.json({ groups: [] });

  const groupIds = links.map((l) => l.group.id);
  const opts = await db
    .select()
    .from(modifierOptions)
    .where(and(inArray(modifierOptions.groupId, groupIds), eq(modifierOptions.available, true)))
    .orderBy(asc(modifierOptions.sortOrder), asc(modifierOptions.name));

  const byGroup = new Map<string, typeof opts>();
  for (const o of opts) {
    if (!byGroup.has(o.groupId)) byGroup.set(o.groupId, []);
    byGroup.get(o.groupId)!.push(o);
  }
  const result = links.map((l) => ({
    id: l.group.id,
    name: l.group.name,
    selectionType: l.group.selectionType,
    required: l.group.required,
    minSelect: l.group.minSelect,
    maxSelect: l.group.maxSelect,
    sortOrder: l.sortOrder,
    dependsOnOptionId: l.dependsOnOptionId,
    modifiers: (byGroup.get(l.group.id) ?? []).map((m) => ({
      id: m.id,
      name: m.name,
      priceDeltaCents: m.priceDeltaCents,
    })),
  }));

  return NextResponse.json({ groups: result }, { headers: { "Cache-Control": "public, max-age=30" } });
}
