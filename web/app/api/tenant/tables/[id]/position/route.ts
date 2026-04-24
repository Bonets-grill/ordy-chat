// web/app/api/tenant/tables/[id]/position/route.ts
//
// PATCH → actualiza coordenadas (pos_x, pos_y) y opcionalmente rotation.
// Usado por el editor del plano cuando el dueño suelta una mesa tras un drag.
//
// Body: { posX: number, posY: number, rotation?: 0|90|180|270 }
// Bounds 0..2000 px (canvas 2000×1500). Rotation 0..359 (paso de 90 desde UI).
// Multi-tenant: la mesa debe pertenecer al tenant autenticado.

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { restaurantTables } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";

const positionSchema = z.object({
  posX: z.number().int().min(0).max(2000),
  posY: z.number().int().min(0).max(2000),
  rotation: z
    .number()
    .int()
    .min(0)
    .max(359)
    .refine((v) => v % 90 === 0, "Rotación debe ser múltiplo de 90")
    .optional(),
});

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const bundle = await requireTenant();
  if (!bundle) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const parsed = positionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "bad_input", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const update: { posX: number; posY: number; rotation?: number; updatedAt: Date } = {
    posX: parsed.data.posX,
    posY: parsed.data.posY,
    updatedAt: new Date(),
  };
  if (parsed.data.rotation !== undefined) update.rotation = parsed.data.rotation;

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
      posX: restaurantTables.posX,
      posY: restaurantTables.posY,
      rotation: restaurantTables.rotation,
    });

  if (!updated) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, table: updated });
}
