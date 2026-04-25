// web/app/api/tenant/modifier-groups/[groupId]/options/[optionId]/route.ts
// PATCH/DELETE de una opción concreta. Ownership validado por join con grupo+tenant.

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { modifierGroups, modifierOptions } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";
import { optionPatchSchema } from "@/lib/modifier-library-schema";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ groupId: string; optionId: string }> };

async function ensureOption(tenantId: string, groupId: string, optionId: string) {
  const [row] = await db
    .select({ id: modifierOptions.id })
    .from(modifierOptions)
    .innerJoin(modifierGroups, eq(modifierGroups.id, modifierOptions.groupId))
    .where(
      and(
        eq(modifierOptions.id, optionId),
        eq(modifierOptions.groupId, groupId),
        eq(modifierGroups.tenantId, tenantId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function PATCH(req: Request, ctx: Ctx) {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { groupId, optionId } = await ctx.params;
  if (!(await ensureOption(bundle.tenant.id, groupId, optionId))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const parsed = optionPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_input", issues: parsed.error.flatten() }, { status: 400 });
  }
  const [updated] = await db
    .update(modifierOptions)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(modifierOptions.id, optionId))
    .returning();
  return NextResponse.json({ option: updated });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { groupId, optionId } = await ctx.params;
  if (!(await ensureOption(bundle.tenant.id, groupId, optionId))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  await db.delete(modifierOptions).where(eq(modifierOptions.id, optionId));
  return NextResponse.json({ ok: true });
}
