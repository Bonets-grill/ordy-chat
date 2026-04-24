// web/app/api/public/menu/[slug]/[itemId]/modifiers/route.ts
//
// Endpoint PÚBLICO (sin auth) — usado por el widget /m/[slug] cuando el
// cliente toca "+" en un item para ver/seleccionar sus modificadores.
//
// Devuelve solo los modifiers con available=true.

import { NextResponse } from "next/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { menuItems, menuItemModifierGroups, menuItemModifiers, tenants } from "@/lib/db/schema";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ slug: string; itemId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug, itemId } = await ctx.params;

  // Resolver tenant por slug (ruta pública).
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

  const groups = await db
    .select()
    .from(menuItemModifierGroups)
    .where(
      and(
        eq(menuItemModifierGroups.menuItemId, itemId),
        eq(menuItemModifierGroups.tenantId, t.id),
      ),
    )
    .orderBy(asc(menuItemModifierGroups.sortOrder), asc(menuItemModifierGroups.name));

  if (groups.length === 0) return NextResponse.json({ groups: [] });

  const groupIds = groups.map((g) => g.id);
  const mods = await db
    .select()
    .from(menuItemModifiers)
    .where(
      and(
        inArray(menuItemModifiers.groupId, groupIds),
        eq(menuItemModifiers.available, true),
      ),
    )
    .orderBy(asc(menuItemModifiers.sortOrder), asc(menuItemModifiers.name));

  const byGroup = new Map<string, typeof mods>();
  for (const m of mods) {
    if (!byGroup.has(m.groupId)) byGroup.set(m.groupId, []);
    byGroup.get(m.groupId)!.push(m);
  }
  const result = groups.map((g) => ({
    id: g.id,
    name: g.name,
    selectionType: g.selectionType,
    required: g.required,
    minSelect: g.minSelect,
    maxSelect: g.maxSelect,
    sortOrder: g.sortOrder,
    modifiers: (byGroup.get(g.id) ?? []).map((m) => ({
      id: m.id,
      name: m.name,
      priceDeltaCents: m.priceDeltaCents,
    })),
  }));

  return NextResponse.json({ groups: result }, { headers: { "Cache-Control": "public, max-age=30" } });
}
