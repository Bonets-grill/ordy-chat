// web/app/api/tenant/menu/[id]/modifiers/route.ts
//
// Asignación de grupos de la biblioteca a un menu_item concreto (mig 051).
//
// GET → grupos asignados a este item con sus opciones, link metadata
//       (sortOrder, dependsOnOptionId) y el id del link.
// PUT → reemplaza el conjunto completo de grupos asignados al item.
//       Body: { groupIds: uuid[] }.
//       Solo añade/quita LINKS — no toca grupos ni opciones de la biblioteca.

import { NextResponse } from "next/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  menuItemModifierGroupLinks,
  menuItems,
  modifierGroups,
  modifierOptions,
} from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";
import { itemLinksReplaceSchema } from "@/lib/modifier-library-schema";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

async function ensureItem(tenantId: string, itemId: string) {
  const [it] = await db
    .select({ id: menuItems.id })
    .from(menuItems)
    .where(and(eq(menuItems.id, itemId), eq(menuItems.tenantId, tenantId)))
    .limit(1);
  return it ?? null;
}

export async function GET(_req: Request, ctx: Ctx) {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  if (!(await ensureItem(bundle.tenant.id, id))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const linked = await db
    .select({
      linkId: menuItemModifierGroupLinks.id,
      sortOrder: menuItemModifierGroupLinks.sortOrder,
      dependsOnOptionId: menuItemModifierGroupLinks.dependsOnOptionId,
      group: modifierGroups,
    })
    .from(menuItemModifierGroupLinks)
    .innerJoin(modifierGroups, eq(modifierGroups.id, menuItemModifierGroupLinks.groupId))
    .where(
      and(
        eq(menuItemModifierGroupLinks.menuItemId, id),
        eq(modifierGroups.tenantId, bundle.tenant.id),
      ),
    )
    .orderBy(asc(menuItemModifierGroupLinks.sortOrder), asc(modifierGroups.name));

  if (linked.length === 0) return NextResponse.json({ groups: [] });

  const groupIds = linked.map((r) => r.group.id);
  const options = await db
    .select()
    .from(modifierOptions)
    .where(inArray(modifierOptions.groupId, groupIds))
    .orderBy(asc(modifierOptions.sortOrder), asc(modifierOptions.name));

  const optsByGroup = new Map<string, typeof options>();
  for (const o of options) {
    if (!optsByGroup.has(o.groupId)) optsByGroup.set(o.groupId, []);
    optsByGroup.get(o.groupId)!.push(o);
  }

  return NextResponse.json({
    groups: linked.map((r) => ({
      ...r.group,
      linkId: r.linkId,
      sortOrder: r.sortOrder,
      dependsOnOptionId: r.dependsOnOptionId,
      options: optsByGroup.get(r.group.id) ?? [],
    })),
  });
}

export async function PUT(req: Request, ctx: Ctx) {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  if (!(await ensureItem(bundle.tenant.id, id))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const parsed = itemLinksReplaceSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_input", issues: parsed.error.flatten() }, { status: 400 });
  }
  const { groupIds } = parsed.data;

  // Solo grupos del tenant — descarta IDs ajenos en silencio.
  const valid =
    groupIds.length === 0
      ? []
      : await db
          .select({ id: modifierGroups.id })
          .from(modifierGroups)
          .where(
            and(eq(modifierGroups.tenantId, bundle.tenant.id), inArray(modifierGroups.id, groupIds)),
          );
  const validIds = valid.map((r) => r.id);

  // Reemplazo atómico: borra todos los links del item y reinserta.
  await db.delete(menuItemModifierGroupLinks).where(eq(menuItemModifierGroupLinks.menuItemId, id));
  if (validIds.length > 0) {
    await db
      .insert(menuItemModifierGroupLinks)
      .values(
        validIds.map((groupId, idx) => ({
          menuItemId: id,
          groupId,
          sortOrder: idx,
        })),
      );
  }

  return NextResponse.json({ ok: true, linked: validIds.length });
}
