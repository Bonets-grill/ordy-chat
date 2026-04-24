// web/app/agent/tables/page.tsx
// Admin de mesas del tenant — CRUD + botón para generar QRs imprimibles.

import { asc } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { restaurantTables } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";
import { TablesEditor } from "./tables-editor";

export const dynamic = "force-dynamic";

export default async function TablesPage() {
  const session = await auth();
  if (!session) redirect("/signin?from=/agent/tables");
  const bundle = await requireTenant();
  if (!bundle) redirect("/onboarding");

  const rows = await db
    .select()
    .from(restaurantTables)
    .where(eq(restaurantTables.tenantId, bundle.tenant.id))
    .orderBy(asc(restaurantTables.sortOrder), asc(restaurantTables.number));

  const initial = rows.map((r) => ({
    id: r.id,
    number: r.number,
    zone: r.zone,
    seats: r.seats,
    active: r.active,
    sortOrder: r.sortOrder,
  }));

  return (
    <AppShell
      session={session}
      subscriptionStatus={bundle.tenant.subscriptionStatus}
      trialDaysLeft={bundle.trialDaysLeft}
    >
      <div className="mx-auto max-w-5xl">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold text-neutral-900">Mesas</h1>
            <p className="mt-1 text-sm text-neutral-500">
              Cada mesa tiene su propio código QR. Imprímelos y pégalos en el local:
              cuando un cliente escanea el QR de su mesa, el bot sabe en qué mesa está
              y puede tomar pedidos directamente.
            </p>
          </div>
          <a
            href="/agent/tables/plano"
            className="rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-sm font-medium text-violet-700 hover:bg-violet-100"
          >
            Abrir plano visual →
          </a>
        </header>
        <TablesEditor initial={initial} tenantSlug={bundle.tenant.slug} />
      </div>
    </AppShell>
  );
}
