// web/lib/onboarding-fast/menu-bootstrap.ts
//
// Mig 028 Fase D: en cuanto el tenant queda provisionado, intentamos extraer
// su carta automáticamente desde el website canónico. Best-effort:
//   - Si no hay website → skip silencioso (menu_pending queda true).
//   - Si scrape devuelve 0 items → skip silencioso.
//   - Si Claude/runtime falla → skip silencioso (logueado en consola).
//
// Importante: este helper NO debe bloquear el provision() ni romper el flujo
// del onboarding. Se invoca con `void attemptMenuBootstrap(...)` para que el
// usuario reciba la URL del QR / dashboard sin esperar al scrape.

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentConfigs, menuItems } from "@/lib/db/schema";

type ScrapedItem = {
  name: string;
  category: string;
  price_cents: number;
  description: string | null;
};

export async function attemptMenuBootstrap(
  tenantId: string,
  websiteUrl: string | null | undefined,
): Promise<void> {
  if (!websiteUrl) return;

  const runtimeUrl = (process.env.RUNTIME_URL ?? "").replace(/\/$/, "");
  const secret = process.env.RUNTIME_INTERNAL_SECRET ?? "";
  if (!runtimeUrl || !secret) return;

  let items: ScrapedItem[] = [];
  try {
    const res = await fetch(`${runtimeUrl}/internal/menu/scrape-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": secret },
      body: JSON.stringify({ tenant_id: tenantId, url: websiteUrl }),
    });
    if (!res.ok) {
      console.warn(`[menu-bootstrap] scrape ${res.status} for tenant ${tenantId}`);
      return;
    }
    const body = (await res.json()) as { items?: ScrapedItem[] };
    items = body.items ?? [];
  } catch (e) {
    console.warn(`[menu-bootstrap] runtime unreachable for tenant ${tenantId}:`, e);
    return;
  }

  if (items.length === 0) {
    console.info(`[menu-bootstrap] zero items extracted for tenant ${tenantId}`);
    return;
  }

  // Auto-asignar sortOrder por categoría preservando el orden del scraper.
  const sortByCategory: Record<string, number> = {};
  const rows = items.map((it) => {
    const cat = it.category || "Otros";
    sortByCategory[cat] = (sortByCategory[cat] ?? 0) + 10;
    return {
      tenantId,
      category: cat,
      name: it.name,
      priceCents: it.price_cents,
      description: it.description ?? null,
      sortOrder: sortByCategory[cat],
      source: "scrape" as const,
    };
  });

  try {
    await db.insert(menuItems).values(rows);
    await db
      .update(agentConfigs)
      .set({ menuPending: false, updatedAt: new Date() })
      .where(eq(agentConfigs.tenantId, tenantId));
    console.info(`[menu-bootstrap] inserted ${rows.length} items for tenant ${tenantId}`);
  } catch (e) {
    console.error(`[menu-bootstrap] insert fail for tenant ${tenantId}:`, e);
  }
}
