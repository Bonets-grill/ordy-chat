// web/app/api/tenant/menu/[id]/restock/route.ts
// POST → reposición rápida de stock para un item.
//
// Body: { qty: number > 0 }
// Comportamiento (mig 044):
//   - Si stock_qty era NULL (sin gestión) → setea stock_qty = qty.
//   - Si stock_qty era N → setea stock_qty = N + qty.
//   - Si available=false y nuevo stock > 0 → reactiva available=true.
//   - Resetea last_low_stock_alert_at = NULL para que la próxima alerta
//     funcione fresh (no atascar el cooldown si reponemos justo después
//     de una alerta).

import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { menuItems } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";

const bodySchema = z.object({
  qty: z.number().int().min(1).max(100_000),
});

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_input", issues: parsed.error.flatten() }, { status: 400 });
  }

  const { qty } = parsed.data;

  // Una sola UPDATE atómica:
  //   - stock_qty = COALESCE(stock_qty, 0) + qty
  //   - available = true si nuevo stock > 0
  //   - last_low_stock_alert_at = NULL (reset cooldown)
  const [updated] = await db
    .update(menuItems)
    .set({
      stockQty: sql`COALESCE(${menuItems.stockQty}, 0) + ${qty}`,
      available: sql`CASE WHEN COALESCE(${menuItems.stockQty}, 0) + ${qty} > 0 THEN true ELSE ${menuItems.available} END`,
      lastLowStockAlertAt: null,
      updatedAt: new Date(),
    })
    .where(and(eq(menuItems.id, id), eq(menuItems.tenantId, bundle.tenant.id)))
    .returning();

  if (!updated) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true, item: updated });
}
