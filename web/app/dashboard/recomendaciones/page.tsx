// web/app/dashboard/recomendaciones/page.tsx
// Mig 046 — el tenant marca qué items de la carta el mesero puede recomendar
// activamente + activa flags de upselling (entrante con principal, postre al
// cerrar, maridaje de bebida). El runtime brain.py lee ambos en el siguiente
// turno (carta + upsell_config se leen cada mensaje, sin caché).

import { asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { AppShell, PageHeader } from "@/components/app-shell";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { agentConfigs, menuItems } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";
import { RecomendacionesEditor } from "./recomendaciones-editor";

export const dynamic = "force-dynamic";

const DEFAULT_UPSELL = {
  suggestStarterWithMain: false,
  suggestDessertAtClose: false,
  suggestPairing: false,
};

export default async function RecomendacionesPage() {
  const session = await auth();
  if (!session) redirect("/signin?from=/dashboard/recomendaciones");
  const bundle = await requireTenant();
  if (!bundle) redirect("/onboarding");

  const items = await db
    .select({
      id: menuItems.id,
      category: menuItems.category,
      name: menuItems.name,
      priceCents: menuItems.priceCents,
      description: menuItems.description,
      available: menuItems.available,
      isRecommended: menuItems.isRecommended,
      sortOrder: menuItems.sortOrder,
    })
    .from(menuItems)
    .where(eq(menuItems.tenantId, bundle.tenant.id))
    .orderBy(asc(menuItems.category), asc(menuItems.sortOrder), asc(menuItems.name));

  const [cfg] = await db
    .select({ upsellConfig: agentConfigs.upsellConfig })
    .from(agentConfigs)
    .where(eq(agentConfigs.tenantId, bundle.tenant.id))
    .limit(1);

  const upsellConfig = cfg?.upsellConfig ?? DEFAULT_UPSELL;

  return (
    <AppShell
      session={session}
      subscriptionStatus={bundle.tenant.subscriptionStatus}
      trialDaysLeft={bundle.trialDaysLeft}
    >
      <PageHeader
        title="Recomendaciones del mesero"
        subtitle="Marca los platos que quieres que el bot priorice al sugerir, y activa las sugerencias proactivas (entrante con el principal, postre al cerrar, maridaje de bebida)."
      />
      <RecomendacionesEditor initialItems={items} initialUpsellConfig={upsellConfig} />
    </AppShell>
  );
}
