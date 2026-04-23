// web/app/agent/tables/print/page.tsx
// Vista imprimible de QRs de mesas. Cada QR lleva el número de mesa
// grande + la URL. Mario → Ctrl+P → PDF/Papel.

import { asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { restaurantTables } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";
import { PrintableQRs } from "./printable-qrs";

export const dynamic = "force-dynamic";

export default async function PrintTablesPage() {
  const session = await auth();
  if (!session) redirect("/signin?from=/agent/tables");
  const bundle = await requireTenant();
  if (!bundle) redirect("/onboarding");

  const rows = await db
    .select()
    .from(restaurantTables)
    .where(eq(restaurantTables.tenantId, bundle.tenant.id))
    .orderBy(asc(restaurantTables.sortOrder), asc(restaurantTables.number));

  const activeRows = rows.filter((r) => r.active);

  // Base URL del widget público. Respeta X-Forwarded-Host si Vercel lo
  // expone; fallback al host canónico.
  const baseUrl = process.env.PUBLIC_APP_URL ?? "https://ordychat.ordysuite.com";

  return (
    <PrintableQRs
      tenantName={bundle.tenant.name}
      tenantSlug={bundle.tenant.slug}
      baseUrl={baseUrl}
      tables={activeRows.map((r) => ({ number: r.number, zone: r.zone }))}
    />
  );
}
