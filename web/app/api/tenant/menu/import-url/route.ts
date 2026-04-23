// web/app/api/tenant/menu/import-url/route.ts
//
// Importa la carta del tenant desde una URL. Llama al runtime que usa
// httpx + Claude para extraer items estructurados. Inserta los items
// con source='scrape' y devuelve count.
//
// Body: { url: string, replaceExisting?: boolean }

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { agentConfigs, menuItems } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";
export const maxDuration = 60; // scrape + Claude extraction puede tardar ~30s

const schema = z.object({
  url: z.string().url(),
  replaceExisting: z.boolean().optional().default(false),
});

export async function POST(req: Request) {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_input", issues: parsed.error.flatten() }, { status: 400 });
  }

  const runtimeUrl = (process.env.RUNTIME_URL ?? "").replace(/\/$/, "");
  const secret = process.env.RUNTIME_INTERNAL_SECRET ?? "";
  if (!runtimeUrl || !secret) {
    return NextResponse.json({ error: "runtime_not_configured" }, { status: 503 });
  }

  let scraped: {
    items: Array<{
      name: string;
      category: string;
      price_cents: number;
      description: string | null;
      image_url?: string | null;
    }>;
  };
  try {
    const r = await fetch(`${runtimeUrl}/internal/menu/scrape-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": secret },
      body: JSON.stringify({ tenant_id: bundle.tenant.id, url: parsed.data.url }),
    });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      return NextResponse.json(
        { error: "scrape_failed", detail: body.detail ?? `HTTP ${r.status}` },
        { status: 422 },
      );
    }
    scraped = await r.json();
  } catch (e) {
    return NextResponse.json(
      { error: "runtime_unreachable", detail: e instanceof Error ? e.message : "unknown" },
      { status: 502 },
    );
  }

  if (!scraped.items?.length) {
    return NextResponse.json(
      { error: "no_items_found", detail: "El scraper no encontró items en esa URL." },
      { status: 422 },
    );
  }

  if (parsed.data.replaceExisting) {
    await db.delete(menuItems).where(eq(menuItems.tenantId, bundle.tenant.id));
  }

  // Auto-asignar sort_order incremental por categoría manteniendo el orden del scraper.
  const sortByCategory: Record<string, number> = {};
  const rows = scraped.items.map((it) => {
    const cat = it.category || "Otros";
    sortByCategory[cat] = (sortByCategory[cat] ?? 0) + 10;
    return {
      tenantId: bundle.tenant.id,
      category: cat,
      name: it.name,
      priceCents: it.price_cents,
      description: it.description ?? null,
      imageUrl: it.image_url ?? null,
      sortOrder: sortByCategory[cat],
      source: "scrape" as const,
    };
  });

  const inserted = await db.insert(menuItems).values(rows).returning({ id: menuItems.id });

  await db
    .update(agentConfigs)
    .set({ menuPending: false, updatedAt: new Date() })
    .where(eq(agentConfigs.tenantId, bundle.tenant.id));

  return NextResponse.json({ ok: true, imported: inserted.length });
}
