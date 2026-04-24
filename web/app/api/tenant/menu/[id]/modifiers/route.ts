// web/app/api/tenant/menu/[id]/modifiers/route.ts
//
// CRUD de grupos de modificadores y sus modifiers para un menu_item.
//
// GET   → lista grupos del item con sus modifiers anidados.
// POST  → crea un grupo (con sus modifiers iniciales) en una transacción.
//
// Multi-tenant: todas las queries pasan tenant_id del bundle. El menu_item se
// valida que pertenezca al tenant antes de tocar grupos.

import { NextResponse } from "next/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { menuItems, menuItemModifierGroups, menuItemModifiers } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";
import { groupCreateSchema } from "@/lib/menu-modifiers-schema";

export const runtime = "nodejs";

// Re-exports para retro-compat (algunos tests pueden importar desde aquí).
export { modifierInputSchema, groupCreateSchema } from "@/lib/menu-modifiers-schema";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;

  // Validar ownership del item.
  const [item] = await db
    .select({ id: menuItems.id })
    .from(menuItems)
    .where(and(eq(menuItems.id, id), eq(menuItems.tenantId, bundle.tenant.id)))
    .limit(1);
  if (!item) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const groups = await db
    .select()
    .from(menuItemModifierGroups)
    .where(
      and(
        eq(menuItemModifierGroups.menuItemId, id),
        eq(menuItemModifierGroups.tenantId, bundle.tenant.id),
      ),
    )
    .orderBy(asc(menuItemModifierGroups.sortOrder), asc(menuItemModifierGroups.name));

  if (groups.length === 0) return NextResponse.json({ groups: [] });

  const groupIds = groups.map((g) => g.id);
  const mods = await db
    .select()
    .from(menuItemModifiers)
    .where(inArray(menuItemModifiers.groupId, groupIds))
    .orderBy(asc(menuItemModifiers.sortOrder), asc(menuItemModifiers.name));

  const byGroup = new Map<string, typeof mods>();
  for (const m of mods) {
    if (!byGroup.has(m.groupId)) byGroup.set(m.groupId, []);
    byGroup.get(m.groupId)!.push(m);
  }
  const result = groups.map((g) => ({ ...g, modifiers: byGroup.get(g.id) ?? [] }));
  return NextResponse.json({ groups: result });
}

export async function POST(req: Request, ctx: Ctx) {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;

  const parsed = groupCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_input", issues: parsed.error.flatten() }, { status: 400 });
  }

  // Ownership.
  const [item] = await db
    .select({ id: menuItems.id })
    .from(menuItems)
    .where(and(eq(menuItems.id, id), eq(menuItems.tenantId, bundle.tenant.id)))
    .limit(1);
  if (!item) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const data = parsed.data;
  const maxSelectFinal = data.selectionType === "single" ? 1 : data.maxSelect;

  // Transacción: grupo + modifiers iniciales atómicos.
  const created = await db.transaction(async (tx) => {
    const [g] = await tx
      .insert(menuItemModifierGroups)
      .values({
        tenantId: bundle.tenant.id,
        menuItemId: id,
        name: data.name,
        selectionType: data.selectionType,
        required: data.required,
        minSelect: data.minSelect,
        maxSelect: maxSelectFinal,
        sortOrder: data.sortOrder,
      })
      .returning();

    let modifiers: Array<typeof menuItemModifiers.$inferSelect> = [];
    if (data.modifiers.length > 0) {
      modifiers = await tx
        .insert(menuItemModifiers)
        .values(
          data.modifiers.map((m) => ({
            groupId: g.id,
            name: m.name,
            priceDeltaCents: m.priceDeltaCents,
            available: m.available,
            sortOrder: m.sortOrder,
          })),
        )
        .returning();
    }
    return { ...g, modifiers };
  });

  return NextResponse.json({ ok: true, group: created });
}
