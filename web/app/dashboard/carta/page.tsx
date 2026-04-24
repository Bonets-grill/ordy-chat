// web/app/dashboard/carta/page.tsx
// Editor de la carta del tenant — mig 028 Fase C.
// Lista items por categoría, permite añadir/editar/borrar manual y
// importar desde URL (scrape automático con Claude).

import { asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { agentConfigs, menuItems } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";
import { CartaEditor } from "./carta-editor";
import { DrinksPitchEditor } from "./drinks-pitch-editor";
import { ReviewsSocialsEditor } from "./reviews-socials-editor";

export const dynamic = "force-dynamic";

export default async function CartaPage() {
  const session = await auth();
  if (!session) redirect("/signin?from=/dashboard/carta");
  const bundle = await requireTenant();
  if (!bundle) redirect("/onboarding");

  const items = await db
    .select()
    .from(menuItems)
    .where(eq(menuItems.tenantId, bundle.tenant.id))
    .orderBy(asc(menuItems.category), asc(menuItems.sortOrder), asc(menuItems.name));

  const [cfg] = await db
    .select({
      drinksGreetingPitch: agentConfigs.drinksGreetingPitch,
      reviewGoogleUrl: agentConfigs.reviewGoogleUrl,
      reviewTripadvisorUrl: agentConfigs.reviewTripadvisorUrl,
      socialInstagramUrl: agentConfigs.socialInstagramUrl,
      socialFacebookUrl: agentConfigs.socialFacebookUrl,
      socialTiktokUrl: agentConfigs.socialTiktokUrl,
    })
    .from(agentConfigs)
    .where(eq(agentConfigs.tenantId, bundle.tenant.id))
    .limit(1);
  const drinksPitch = cfg?.drinksGreetingPitch ?? null;
  const reviewsSocials = {
    reviewGoogleUrl: cfg?.reviewGoogleUrl ?? null,
    reviewTripadvisorUrl: cfg?.reviewTripadvisorUrl ?? null,
    socialInstagramUrl: cfg?.socialInstagramUrl ?? null,
    socialFacebookUrl: cfg?.socialFacebookUrl ?? null,
    socialTiktokUrl: cfg?.socialTiktokUrl ?? null,
  };

  const initial = items.map((it) => ({
    id: it.id,
    category: it.category,
    name: it.name,
    priceCents: it.priceCents,
    description: it.description,
    imageUrl: it.imageUrl,
    available: it.available,
    sortOrder: it.sortOrder,
    source: it.source,
    // Mig 044 — control de stock numérico opcional.
    stockQty: it.stockQty,
    lowStockThreshold: it.lowStockThreshold,
  }));

  return (
    <AppShell
      session={session}
      subscriptionStatus={bundle.tenant.subscriptionStatus}
      trialDaysLeft={bundle.trialDaysLeft}
    >
      <div className="mx-auto max-w-5xl">
        <header className="mb-6">
          <h1 className="text-3xl font-semibold text-neutral-900">Carta</h1>
          <p className="mt-1 text-sm text-neutral-500">
            La carta vigente del negocio. El bot usa estos items y precios para responder
            a tus clientes. Importa desde tu web o añade items uno por uno.
          </p>
        </header>
        <div className="mb-6">
          <DrinksPitchEditor initialPitch={drinksPitch} />
        </div>
        <div className="mb-6">
          <ReviewsSocialsEditor initial={reviewsSocials} />
        </div>
        <CartaEditor initial={initial} />
      </div>
    </AppShell>
  );
}
