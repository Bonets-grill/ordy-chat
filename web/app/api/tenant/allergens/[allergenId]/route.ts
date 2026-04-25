// web/app/api/tenant/allergens/[allergenId]/route.ts
// PATCH/DELETE alérgeno biblioteca. Ownership por tenant_id.

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { allergens } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";
import { allergenPatchSchema } from "@/lib/allergen-library-schema";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ allergenId: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { allergenId } = await ctx.params;

  const parsed = allergenPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_input", issues: parsed.error.flatten() }, { status: 400 });
  }

  const [updated] = await db
    .update(allergens)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(allergens.id, allergenId), eq(allergens.tenantId, bundle.tenant.id)))
    .returning();

  if (!updated) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ allergen: updated });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { allergenId } = await ctx.params;

  const [deleted] = await db
    .delete(allergens)
    .where(and(eq(allergens.id, allergenId), eq(allergens.tenantId, bundle.tenant.id)))
    .returning({ id: allergens.id });
  if (!deleted) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
