// web/app/api/tenant/allergens/route.ts
//
// Biblioteca de alérgenos del tenant (mig 051).
// GET  → lista todos los alérgenos del tenant + cuántos productos los usan.
// POST → crea un alérgeno nuevo.

import { NextResponse } from "next/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { allergens, menuItemAllergens } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";
import { allergenCreateSchema } from "@/lib/allergen-library-schema";

export const runtime = "nodejs";

export async function GET() {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rows = await db
    .select()
    .from(allergens)
    .where(eq(allergens.tenantId, bundle.tenant.id))
    .orderBy(asc(allergens.sortOrder), asc(allergens.label));

  if (rows.length === 0) return NextResponse.json({ allergens: [] });

  const ids = rows.map((r) => r.id);
  const links = await db
    .select({ allergenId: menuItemAllergens.allergenId, menuItemId: menuItemAllergens.menuItemId })
    .from(menuItemAllergens)
    .where(inArray(menuItemAllergens.allergenId, ids));

  const byAllergen = new Map<string, string[]>();
  for (const l of links) {
    if (!byAllergen.has(l.allergenId)) byAllergen.set(l.allergenId, []);
    byAllergen.get(l.allergenId)!.push(l.menuItemId);
  }

  return NextResponse.json({
    allergens: rows.map((a) => ({ ...a, assignedMenuItemIds: byAllergen.get(a.id) ?? [] })),
  });
}

export async function POST(req: Request) {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = allergenCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_input", issues: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  const [existing] = await db
    .select({ id: allergens.id })
    .from(allergens)
    .where(and(eq(allergens.tenantId, bundle.tenant.id), eq(allergens.code, data.code)))
    .limit(1);
  if (existing) return NextResponse.json({ error: "code_taken" }, { status: 409 });

  const [created] = await db
    .insert(allergens)
    .values({ tenantId: bundle.tenant.id, ...data })
    .returning();
  return NextResponse.json({ allergen: { ...created, assignedMenuItemIds: [] } }, { status: 201 });
}
