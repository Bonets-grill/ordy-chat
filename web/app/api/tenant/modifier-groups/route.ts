// web/app/api/tenant/modifier-groups/route.ts
//
// Biblioteca de grupos de modificadores del tenant (mig 051).
//
// GET   → lista de grupos del tenant con sus opciones anidadas y la lista de
//         menu_item_id que cada grupo tiene asignados (para mostrar "usado en N
//         productos" en la UI).
// POST  → crea un grupo nuevo en la biblioteca, opcionalmente con sus opciones
//         iniciales en una sola transacción.

import { NextResponse } from "next/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { menuItemModifierGroupLinks, modifierGroups, modifierOptions } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";
import { groupCreateSchema } from "@/lib/modifier-library-schema";

export const runtime = "nodejs";

export async function GET() {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const groups = await db
    .select()
    .from(modifierGroups)
    .where(eq(modifierGroups.tenantId, bundle.tenant.id))
    .orderBy(asc(modifierGroups.sortOrder), asc(modifierGroups.name));

  if (groups.length === 0) return NextResponse.json({ groups: [] });

  const groupIds = groups.map((g) => g.id);

  const [options, links] = await Promise.all([
    db
      .select()
      .from(modifierOptions)
      .where(inArray(modifierOptions.groupId, groupIds))
      .orderBy(asc(modifierOptions.sortOrder), asc(modifierOptions.name)),
    db
      .select({ groupId: menuItemModifierGroupLinks.groupId, menuItemId: menuItemModifierGroupLinks.menuItemId })
      .from(menuItemModifierGroupLinks)
      .where(inArray(menuItemModifierGroupLinks.groupId, groupIds)),
  ]);

  const optsByGroup = new Map<string, typeof options>();
  for (const o of options) {
    if (!optsByGroup.has(o.groupId)) optsByGroup.set(o.groupId, []);
    optsByGroup.get(o.groupId)!.push(o);
  }
  const itemsByGroup = new Map<string, string[]>();
  for (const l of links) {
    if (!itemsByGroup.has(l.groupId)) itemsByGroup.set(l.groupId, []);
    itemsByGroup.get(l.groupId)!.push(l.menuItemId);
  }

  const result = groups.map((g) => ({
    ...g,
    options: optsByGroup.get(g.id) ?? [],
    assignedMenuItemIds: itemsByGroup.get(g.id) ?? [],
  }));
  return NextResponse.json({ groups: result });
}

export async function POST(req: Request) {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = groupCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_input", issues: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;
  const maxSelect = data.selectionType === "single" ? 1 : data.maxSelect;

  // Existe ya un grupo con ese nombre? La UNIQUE de DB lo bloquearía pero damos
  // un 409 explícito para que el cliente lo muestre.
  const [existing] = await db
    .select({ id: modifierGroups.id })
    .from(modifierGroups)
    .where(and(eq(modifierGroups.tenantId, bundle.tenant.id), eq(modifierGroups.name, data.name)))
    .limit(1);
  if (existing) {
    return NextResponse.json({ error: "name_taken" }, { status: 409 });
  }

  const [group] = await db
    .insert(modifierGroups)
    .values({
      tenantId: bundle.tenant.id,
      name: data.name,
      selectionType: data.selectionType,
      required: data.required,
      minSelect: data.minSelect,
      maxSelect,
      sortOrder: data.sortOrder,
    })
    .returning();

  let options: Array<typeof modifierOptions.$inferSelect> = [];
  if (data.options.length > 0) {
    options = await db
      .insert(modifierOptions)
      .values(
        data.options.map((o) => ({
          groupId: group.id,
          name: o.name,
          priceDeltaCents: o.priceDeltaCents,
          available: o.available,
          sortOrder: o.sortOrder,
        })),
      )
      .returning();
  }

  return NextResponse.json({ group: { ...group, options, assignedMenuItemIds: [] } }, { status: 201 });
}
