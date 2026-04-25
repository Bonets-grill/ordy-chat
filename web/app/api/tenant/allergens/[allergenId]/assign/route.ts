// web/app/api/tenant/allergens/[allergenId]/assign/route.ts
// Asignación masiva: aplica este alérgeno a N productos.
// append=false reemplaza el set completo.

import { NextResponse } from "next/server";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { allergens, menuItemAllergens, menuItems } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";
import { allergenAssignSchema } from "@/lib/allergen-library-schema";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ allergenId: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { allergenId } = await ctx.params;

  const [a] = await db
    .select({ id: allergens.id })
    .from(allergens)
    .where(and(eq(allergens.id, allergenId), eq(allergens.tenantId, bundle.tenant.id)))
    .limit(1);
  if (!a) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const parsed = allergenAssignSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_input", issues: parsed.error.flatten() }, { status: 400 });
  }
  const { menuItemIds, append } = parsed.data;

  const validItems = await db
    .select({ id: menuItems.id })
    .from(menuItems)
    .where(and(eq(menuItems.tenantId, bundle.tenant.id), inArray(menuItems.id, menuItemIds)));
  const validIds = validItems.map((r) => r.id);

  if (!append) {
    if (validIds.length === 0) {
      await db.delete(menuItemAllergens).where(eq(menuItemAllergens.allergenId, allergenId));
    } else {
      await db
        .delete(menuItemAllergens)
        .where(
          and(
            eq(menuItemAllergens.allergenId, allergenId),
            notInArray(menuItemAllergens.menuItemId, validIds),
          ),
        );
    }
  }

  if (validIds.length > 0) {
    await db
      .insert(menuItemAllergens)
      .values(validIds.map((menuItemId) => ({ menuItemId, allergenId })))
      .onConflictDoNothing();
  }

  return NextResponse.json({
    ok: true,
    assigned: validIds.length,
    skipped: menuItemIds.length - validIds.length,
  });
}
