// web/app/api/comandero/menu/route.ts
//
// GET — devuelve la carta canónica (español) del tenant con los modifiers
// asignados a cada item via menu_item_modifier_group_links + biblioteca
// (mig 051). Pensado para el comandero (mesero humano tomando pedidos).
// Auth de session. La carta para el cliente final usa /api/public/menu-i18n.

import { NextResponse } from "next/server";
import { eq, asc, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  menuItems,
  menuItemModifierGroupLinks,
  modifierGroups,
  modifierOptions,
} from "@/lib/db/schema";
import { getComanderoActor } from "@/lib/employees/scope";

export const dynamic = "force-dynamic";

export async function GET() {
  const actor = await getComanderoActor();
  if (!actor) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const items = await db
    .select({
      id: menuItems.id,
      name: menuItems.name,
      description: menuItems.description,
      priceCents: menuItems.priceCents,
      category: menuItems.category,
      imageUrl: menuItems.imageUrl,
      available: menuItems.available,
      isRecommended: menuItems.isRecommended,
      stockQty: menuItems.stockQty,
      sortOrder: menuItems.sortOrder,
    })
    .from(menuItems)
    .where(eq(menuItems.tenantId, actor.tenantId))
    .orderBy(asc(menuItems.sortOrder), asc(menuItems.name));

  const visibleItems = items.filter((it) => it.available);
  if (visibleItems.length === 0) return NextResponse.json({ items: [] });

  const itemIds = visibleItems.map((it) => it.id);

  const links = await db
    .select({
      menuItemId: menuItemModifierGroupLinks.menuItemId,
      linkSortOrder: menuItemModifierGroupLinks.sortOrder,
      dependsOnOptionId: menuItemModifierGroupLinks.dependsOnOptionId,
      group: modifierGroups,
    })
    .from(menuItemModifierGroupLinks)
    .innerJoin(modifierGroups, eq(modifierGroups.id, menuItemModifierGroupLinks.groupId))
    .where(inArray(menuItemModifierGroupLinks.menuItemId, itemIds))
    .orderBy(asc(menuItemModifierGroupLinks.sortOrder), asc(modifierGroups.name));

  const groupIds = Array.from(new Set(links.map((l) => l.group.id)));
  const allOptions = groupIds.length
    ? await db
        .select()
        .from(modifierOptions)
        .where(inArray(modifierOptions.groupId, groupIds))
        .orderBy(asc(modifierOptions.sortOrder), asc(modifierOptions.name))
    : [];

  const optsByGroup = new Map<string, typeof allOptions>();
  for (const o of allOptions) {
    const arr = optsByGroup.get(o.groupId) ?? [];
    arr.push(o);
    optsByGroup.set(o.groupId, arr);
  }

  const linksByItem = new Map<string, typeof links>();
  for (const l of links) {
    const arr = linksByItem.get(l.menuItemId) ?? [];
    arr.push(l);
    linksByItem.set(l.menuItemId, arr);
  }

  const itemsWithMods = visibleItems.map((it) => ({
    ...it,
    modifierGroups: (linksByItem.get(it.id) ?? []).map((l) => ({
      id: l.group.id,
      name: l.group.name,
      selectionType: l.group.selectionType,
      required: l.group.required,
      minSelect: l.group.minSelect,
      maxSelect: l.group.maxSelect,
      dependsOnOptionId: l.dependsOnOptionId,
      modifiers: (optsByGroup.get(l.group.id) ?? [])
        .filter((m) => m.available)
        .map((m) => ({
          id: m.id,
          name: m.name,
          priceDeltaCents: m.priceDeltaCents,
        })),
    })),
  }));

  return NextResponse.json({ items: itemsWithMods });
}
