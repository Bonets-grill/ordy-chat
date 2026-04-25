// web/app/c/[slug]/manifest.webmanifest/route.ts
//
// Manifest PWA dinámico por tenant. Cuando el mesero hace "Compartir →
// Añadir a pantalla de inicio" desde Safari iOS sobre /c/<slug>, iOS
// resuelve <link rel="manifest"> a este endpoint y registra la PWA con
// nombre del restaurante + start_url=/c/<slug> + standalone fullscreen.

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tenants } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) {
    return NextResponse.json({ error: "bad_slug" }, { status: 400 });
  }
  const [tenant] = await db
    .select({ name: tenants.name, brandColor: tenants.brandColor })
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1);
  if (!tenant) {
    return NextResponse.json({ error: "tenant_not_found" }, { status: 404 });
  }
  const themeColor = /^#[0-9a-fA-F]{6}$/.test(tenant.brandColor) ? tenant.brandColor : "#0a0a0a";
  return NextResponse.json(
    {
      name: `Comandero · ${tenant.name}`,
      short_name: tenant.name.slice(0, 12),
      description: "Comandero del restaurante para meseros.",
      start_url: `/c/${slug}`,
      scope: `/c/${slug}`,
      display: "standalone",
      orientation: "portrait",
      background_color: "#0a0a0a",
      theme_color: themeColor,
      categories: ["business", "food"],
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/icon-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=3600" } },
  );
}
