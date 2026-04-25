// web/app/api/tenant/modifier-groups/[groupId]/options/route.ts
//
// CRUD básico de opciones dentro de un grupo de la biblioteca.
// GET  → lista opciones del grupo (validando ownership por tenant_id).
// POST → crea una opción nueva.

import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { modifierGroups, modifierOptions } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";
import { optionInputSchema } from "@/lib/modifier-library-schema";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ groupId: string }> };

async function ensureGroup(tenantId: string, groupId: string) {
  const [g] = await db
    .select({ id: modifierGroups.id })
    .from(modifierGroups)
    .where(and(eq(modifierGroups.id, groupId), eq(modifierGroups.tenantId, tenantId)))
    .limit(1);
  return g ?? null;
}

export async function GET(_req: Request, ctx: Ctx) {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { groupId } = await ctx.params;
  if (!(await ensureGroup(bundle.tenant.id, groupId))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const options = await db
    .select()
    .from(modifierOptions)
    .where(eq(modifierOptions.groupId, groupId))
    .orderBy(asc(modifierOptions.sortOrder), asc(modifierOptions.name));
  return NextResponse.json({ options });
}

export async function POST(req: Request, ctx: Ctx) {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { groupId } = await ctx.params;
  if (!(await ensureGroup(bundle.tenant.id, groupId))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const parsed = optionInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_input", issues: parsed.error.flatten() }, { status: 400 });
  }
  const [option] = await db
    .insert(modifierOptions)
    .values({ groupId, ...parsed.data })
    .returning();
  return NextResponse.json({ option }, { status: 201 });
}
