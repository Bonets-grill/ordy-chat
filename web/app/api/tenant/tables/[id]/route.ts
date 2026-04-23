// web/app/api/tenant/tables/[id]/route.ts
//
// PATCH → editar una mesa del tenant.
// DELETE → borrar una mesa del tenant.
//
// Ambas validan que la mesa pertenezca al tenant autenticado.

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { restaurantTables } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";

const patchSchema = z.object({
  number: z.string().trim().min(1).max(8).regex(/^[A-Za-z0-9-]+$/).optional(),
  zone: z.string().trim().max(60).nullable().optional(),
  seats: z.number().int().min(1).max(99).optional(),
  active: z.boolean().optional(),
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

  try {
    const [updated] = await db
      .update(restaurantTables)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(
        and(eq(restaurantTables.id, id), eq(restaurantTables.tenantId, bundle.tenant.id)),
      )
      .returning();
    if (!updated) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ ok: true, table: updated });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("duplicate key") || msg.includes("23505")) {
      return NextResponse.json(
        { error: "duplicate", detail: "Ya existe otra mesa con ese número" },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "db_error", detail: msg.slice(0, 200) }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const res = await db
    .delete(restaurantTables)
    .where(
      and(eq(restaurantTables.id, id), eq(restaurantTables.tenantId, bundle.tenant.id)),
    )
    .returning({ id: restaurantTables.id });

  if (res.length === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
