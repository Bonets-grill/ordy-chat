// web/app/api/tenant/modifier-groups/[groupId]/assign/route.ts
//
// Asignación masiva del grupo a N productos del tenant.
// Body: { menuItemIds: uuid[], append?: boolean }
//   append=true  → añade. Productos ya enlazados se ignoran (UNIQUE).
//   append=false → reemplaza el set completo de productos asignados a este grupo.

import { NextResponse } from "next/server";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { menuItemModifierGroupLinks, menuItems, modifierGroups } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";
import { groupAssignSchema } from "@/lib/modifier-library-schema";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ groupId: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { groupId } = await ctx.params;

  // Ownership del grupo.
  const [g] = await db
    .select({ id: modifierGroups.id })
    .from(modifierGroups)
    .where(and(eq(modifierGroups.id, groupId), eq(modifierGroups.tenantId, bundle.tenant.id)))
    .limit(1);
  if (!g) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const parsed = groupAssignSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_input", issues: parsed.error.flatten() }, { status: 400 });
  }
  const { menuItemIds, append } = parsed.data;

  // Filtra IDs que sí pertenezcan al tenant. Cualquier id ajeno se descarta sin
  // error explícito (fail-soft: evita oracle de pertenencia cross-tenant).
  const validItems = await db
    .select({ id: menuItems.id })
    .from(menuItems)
    .where(and(eq(menuItems.tenantId, bundle.tenant.id), inArray(menuItems.id, menuItemIds)));
  const validIds = validItems.map((r) => r.id);

  if (!append) {
    // Borra links del grupo cuyos menu_item_id no estén en la nueva lista.
    if (validIds.length === 0) {
      await db.delete(menuItemModifierGroupLinks).where(eq(menuItemModifierGroupLinks.groupId, groupId));
    } else {
      await db
        .delete(menuItemModifierGroupLinks)
        .where(
          and(
            eq(menuItemModifierGroupLinks.groupId, groupId),
            notInArray(menuItemModifierGroupLinks.menuItemId, validIds),
          ),
        );
    }
  }

  if (validIds.length > 0) {
    await db
      .insert(menuItemModifierGroupLinks)
      .values(validIds.map((menuItemId) => ({ menuItemId, groupId })))
      .onConflictDoNothing();
  }

  return NextResponse.json({
    ok: true,
    assigned: validIds.length,
    skipped: menuItemIds.length - validIds.length,
  });
}
