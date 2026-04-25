// web/app/api/comandero/menu/route.ts
//
// GET — devuelve la carta canónica (español) del tenant con modifiers de cada
// item. Pensado para el comandero (mesero humano tomando pedidos en mesa).
// Auth de session. La carta para el cliente final usa /api/public/menu-i18n.

import { NextResponse } from "next/server";
import { eq, asc, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  menuItems,
  menuItemModifierGroups,
  menuItemModifiers,
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

  const groups = await db
    .select()
    .from(menuItemModifierGroups)
    .where(eq(menuItemModifierGroups.tenantId, actor.tenantId))
    .orderBy(asc(menuItemModifierGroups.sortOrder));

  const allMods = groups.length
    ? await db
        .select()
        .from(menuItemModifiers)
        .where(
          inArray(
            menuItemModifiers.groupId,
            groups.map((g) => g.id),
          ),
        )
        .orderBy(asc(menuItemModifiers.sortOrder))
    : [];

  const modsByGroup = new Map<string, typeof allMods>();
  for (const m of allMods) {
    const arr = modsByGroup.get(m.groupId) ?? [];
    arr.push(m);
    modsByGroup.set(m.groupId, arr);
  }

  const itemsWithMods = items
    .filter((it) => it.available)
    .map((it) => ({
      ...it,
      modifierGroups: groups
        .filter((g) => g.menuItemId === it.id)
        .map((g) => ({
          id: g.id,
          name: g.name,
          selectionType: g.selectionType,
          required: g.required,
          minSelect: g.minSelect,
          maxSelect: g.maxSelect,
          modifiers: (modsByGroup.get(g.id) ?? [])
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
