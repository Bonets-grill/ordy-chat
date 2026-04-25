// web/app/api/tenant/menu/[id]/allergens/route.ts
//
// GET → alérgenos asignados a este producto (vía menu_item_allergens).
// PUT → reemplaza el conjunto completo de alérgenos del producto.
//       Body: { allergenIds: uuid[] }.
//
// Solo añade/quita LINKS — no toca la biblioteca de alérgenos del tenant.

import { NextResponse } from "next/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { allergens, menuItemAllergens, menuItems } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";
import { itemAllergensReplaceSchema } from "@/lib/allergen-library-schema";

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

  const rows = await db
    .select({
      id: allergens.id,
      code: allergens.code,
      label: allergens.label,
      icon: allergens.icon,
      sortOrder: allergens.sortOrder,
      i18nTranslations: allergens.i18nTranslations,
    })
    .from(menuItemAllergens)
    .innerJoin(allergens, eq(allergens.id, menuItemAllergens.allergenId))
    .where(
      and(eq(menuItemAllergens.menuItemId, id), eq(allergens.tenantId, bundle.tenant.id)),
    )
    .orderBy(asc(allergens.sortOrder), asc(allergens.label));

  return NextResponse.json({ allergens: rows });
}

export async function PUT(req: Request, ctx: Ctx) {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  if (!(await ensureItem(bundle.tenant.id, id))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const parsed = itemAllergensReplaceSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_input", issues: parsed.error.flatten() }, { status: 400 });
  }
  const { allergenIds } = parsed.data;

  const valid =
    allergenIds.length === 0
      ? []
      : await db
          .select({ id: allergens.id })
          .from(allergens)
          .where(and(eq(allergens.tenantId, bundle.tenant.id), inArray(allergens.id, allergenIds)));
  const validIds = valid.map((r) => r.id);

  await db.delete(menuItemAllergens).where(eq(menuItemAllergens.menuItemId, id));
  if (validIds.length > 0) {
    await db
      .insert(menuItemAllergens)
      .values(validIds.map((allergenId) => ({ menuItemId: id, allergenId })));
  }

  return NextResponse.json({ ok: true, linked: validIds.length });
}
