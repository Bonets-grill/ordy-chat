// web/app/api/public/menu-i18n/[slug]/route.ts
//
// GET /api/public/menu-i18n/<slug>?lang=en — Carta del tenant traducida al
// idioma solicitado. Si lang=es o no soportado, devuelve canónico. Cachea
// las traducciones via Anthropic en menu_items.i18n_translations.
//
// Endpoint público (sin auth), rate-limited por IP.

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tenants } from "@/lib/db/schema";
import { limitByIpWebchat } from "@/lib/rate-limit";
import {
  SUPPORTED_LANGS,
  type SupportedLang,
  getCanonicalMenu,
  getTranslatedMenu,
} from "@/lib/i18n/menu-translate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  const rl = await limitByIpWebchat(ip);
  if (!rl.ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const [tenant] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1);
  if (!tenant) {
    return NextResponse.json({ error: "tenant_not_found" }, { status: 404 });
  }

  const langParam =
    new URL(req.url).searchParams.get("lang")?.toLowerCase().split("-")[0] ?? "es";

  if (langParam === "es") {
    const items = await getCanonicalMenu(tenant.id);
    return NextResponse.json({
      lang: "es",
      items: items
        .filter((i) => i.available)
        .map((i) => ({
          id: i.id,
          name: i.name,
          description: i.description,
          priceCents: i.priceCents,
          category: i.category,
          imageUrl: i.imageUrl,
        })),
    });
  }

  if (!(SUPPORTED_LANGS as readonly string[]).includes(langParam)) {
    return NextResponse.json({ error: "unsupported_lang" }, { status: 400 });
  }

  const data = await getTranslatedMenu(tenant.id, langParam as SupportedLang);
  return NextResponse.json({
    lang: langParam,
    items: data.items,
    modifierGroups: data.modifierGroups,
    modifiers: data.modifiers,
  });
}
