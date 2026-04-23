// web/app/api/tenant/menu/[id]/route.ts
// PATCH → editar item. DELETE → borrar item.

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { menuItems } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";

const patchSchema = z.object({
  category: z.string().min(1).max(80).optional(),
  name: z.string().min(1).max(200).optional(),
  priceCents: z.number().int().min(0).max(100_000).optional(),
  description: z.string().max(500).nullable().optional(),
  imageUrl: z.string().url().max(500).nullable().optional(),
  available: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_input", issues: parsed.error.flatten() }, { status: 400 });
  }

  const [updated] = await db
    .update(menuItems)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(menuItems.id, id), eq(menuItems.tenantId, bundle.tenant.id)))
    .returning();

  if (!updated) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true, item: updated });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const res = await db
    .delete(menuItems)
    .where(and(eq(menuItems.id, id), eq(menuItems.tenantId, bundle.tenant.id)))
    .returning({ id: menuItems.id });

  if (res.length === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
