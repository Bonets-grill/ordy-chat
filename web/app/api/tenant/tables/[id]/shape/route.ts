// web/app/api/tenant/tables/[id]/shape/route.ts
//
// PATCH → actualiza propiedades visuales/semánticas de una mesa: forma,
// capacidad, dimensiones y área (Terraza/Salón/Barra).
//
// Body: { shape?, seats?, width?, height?, area? }
// Multi-tenant: la mesa debe pertenecer al tenant autenticado.

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { restaurantTables } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";

const shapeSchema = z
  .object({
    shape: z.enum(["square", "round", "rect"]).optional(),
    seats: z.number().int().min(1).max(30).optional(),
    width: z.number().int().min(40).max(200).optional(),
    height: z.number().int().min(40).max(200).optional(),
    area: z.string().trim().max(60).nullable().optional(),
  })
  .refine(
    (d) =>
      d.shape !== undefined ||
      d.seats !== undefined ||
      d.width !== undefined ||
      d.height !== undefined ||
      d.area !== undefined,
    { message: "Debe incluir al menos un campo" },
  );

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const bundle = await requireTenant();
  if (!bundle) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const parsed = shapeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "bad_input", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Construye el SET sólo con campos presentes — no sobrescribe con undefined.
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.shape !== undefined) update.shape = parsed.data.shape;
  if (parsed.data.seats !== undefined) update.seats = parsed.data.seats;
  if (parsed.data.width !== undefined) update.width = parsed.data.width;
  if (parsed.data.height !== undefined) update.height = parsed.data.height;
  if (parsed.data.area !== undefined) {
    update.area = parsed.data.area === "" ? null : parsed.data.area;
  }

  const [updated] = await db
    .update(restaurantTables)
    .set(update)
    .where(
      and(
        eq(restaurantTables.id, id),
        eq(restaurantTables.tenantId, bundle.tenant.id),
      ),
    )
    .returning({
      id: restaurantTables.id,
      shape: restaurantTables.shape,
      seats: restaurantTables.seats,
      width: restaurantTables.width,
      height: restaurantTables.height,
      area: restaurantTables.area,
    });

  if (!updated) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, table: updated });
}
