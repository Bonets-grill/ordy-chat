// web/app/api/tenant/menu/route.ts
//
// CRUD de menu_items para el tenant logueado.
//
// GET   → lista todos los items del tenant agrupados por categoría.
// POST  → crea un item nuevo (validado).
// DELETE → ?all=1 borra TODA la carta del tenant (peligroso, pide confirmación en UI).

import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { agentConfigs, menuItems } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";

const createSchema = z.object({
  category: z.string().min(1).max(80).default("Otros"),
  name: z.string().min(1).max(200),
  priceCents: z.number().int().min(0).max(100_000),
  description: z.string().max(500).optional().nullable(),
  // URL absoluta de imagen del item. Para los items que no se
  // capturaron del scrape o que Mario quiere reemplazar.
  imageUrl: z.string().url().max(500).optional().nullable(),
  available: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});

export async function GET() {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const items = await db
    .select()
    .from(menuItems)
    .where(eq(menuItems.tenantId, bundle.tenant.id))
    .orderBy(asc(menuItems.category), asc(menuItems.sortOrder), asc(menuItems.name));

  return NextResponse.json({ items });
}

export async function POST(req: Request) {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_input", issues: parsed.error.flatten() }, { status: 400 });
  }

  const [created] = await db
    .insert(menuItems)
    .values({
      tenantId: bundle.tenant.id,
      category: parsed.data.category,
      name: parsed.data.name,
      priceCents: parsed.data.priceCents,
      description: parsed.data.description ?? null,
      imageUrl: parsed.data.imageUrl ?? null,
      available: parsed.data.available,
      sortOrder: parsed.data.sortOrder,
      source: "manual",
    })
    .returning();

  // Bajamos el flag menu_pending si era el primer item.
  await db
    .update(agentConfigs)
    .set({ menuPending: false, updatedAt: new Date() })
    .where(eq(agentConfigs.tenantId, bundle.tenant.id));

  return NextResponse.json({ ok: true, item: created });
}

export async function DELETE(req: Request) {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  if (url.searchParams.get("all") !== "1") {
    return NextResponse.json({ error: "use ?all=1 to confirm bulk delete" }, { status: 400 });
  }

  await db.delete(menuItems).where(eq(menuItems.tenantId, bundle.tenant.id));
  await db
    .update(agentConfigs)
    .set({ menuPending: true, updatedAt: new Date() })
    .where(eq(agentConfigs.tenantId, bundle.tenant.id));

  return NextResponse.json({ ok: true });
}
