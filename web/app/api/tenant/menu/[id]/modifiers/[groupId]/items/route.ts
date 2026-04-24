// web/app/api/tenant/menu/[id]/modifiers/[groupId]/items/route.ts
//
// POST → añade un modifier al grupo. Valida ownership: el grupo debe ser del
// tenant Y del menu_item de la URL. Zod rechaza price_delta_cents negativos
// (la DB también lo rechazaría con CHECK, pero queremos error claro).

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { menuItemModifierGroups, menuItemModifiers } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";

const modifierCreateSchema = z.object({
  name: z.string().min(1).max(120),
  priceDeltaCents: z.number().int().min(0).max(100_000),
  available: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});

type Ctx = { params: Promise<{ id: string; groupId: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id, groupId } = await ctx.params;

  const parsed = modifierCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_input", issues: parsed.error.flatten() }, { status: 400 });
  }

  // Validar que el grupo pertenece al item Y al tenant.
  const [group] = await db
    .select({ id: menuItemModifierGroups.id })
    .from(menuItemModifierGroups)
    .where(
      and(
        eq(menuItemModifierGroups.id, groupId),
        eq(menuItemModifierGroups.menuItemId, id),
        eq(menuItemModifierGroups.tenantId, bundle.tenant.id),
      ),
    )
    .limit(1);
  if (!group) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const [created] = await db
    .insert(menuItemModifiers)
    .values({
      groupId: group.id,
      name: parsed.data.name,
      priceDeltaCents: parsed.data.priceDeltaCents,
      available: parsed.data.available,
      sortOrder: parsed.data.sortOrder,
    })
    .returning();

  return NextResponse.json({ ok: true, modifier: created });
}
