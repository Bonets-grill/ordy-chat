// web/app/dashboard/alergenos/page.tsx
//
// Biblioteca de alérgenos del tenant (mig 051). Reemplaza el array de strings
// suelto que vivía en menu_items.allergens. Ahora se define una vez y se
// asigna a N productos con multi-select.

import { asc, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { AppShell, PageHeader } from "@/components/app-shell";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { allergens, menuItemAllergens, menuItems } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";
import { AllergensEditor } from "./allergens-editor";

export const dynamic = "force-dynamic";

export default async function AlergenosPage() {
  const session = await auth();
  if (!session) redirect("/signin?from=/dashboard/alergenos");
  const bundle = await requireTenant();
  if (!bundle) redirect("/onboarding");

  const rows = await db
    .select()
    .from(allergens)
    .where(eq(allergens.tenantId, bundle.tenant.id))
    .orderBy(asc(allergens.sortOrder), asc(allergens.label));

  const ids = rows.map((r) => r.id);
  const [links, items] = await Promise.all([
    ids.length
      ? db
          .select({ allergenId: menuItemAllergens.allergenId, menuItemId: menuItemAllergens.menuItemId })
          .from(menuItemAllergens)
          .where(inArray(menuItemAllergens.allergenId, ids))
      : Promise.resolve([] as Array<{ allergenId: string; menuItemId: string }>),
    db
      .select({
        id: menuItems.id,
        category: menuItems.category,
        name: menuItems.name,
        priceCents: menuItems.priceCents,
      })
      .from(menuItems)
      .where(eq(menuItems.tenantId, bundle.tenant.id))
      .orderBy(asc(menuItems.category), asc(menuItems.sortOrder), asc(menuItems.name)),
  ]);

  const byAllergen = new Map<string, string[]>();
  for (const l of links) {
    if (!byAllergen.has(l.allergenId)) byAllergen.set(l.allergenId, []);
    byAllergen.get(l.allergenId)!.push(l.menuItemId);
  }
  const initial = rows.map((a) => ({ ...a, assignedMenuItemIds: byAllergen.get(a.id) ?? [] }));

  return (
    <AppShell
      session={session}
      subscriptionStatus={bundle.tenant.subscriptionStatus}
      trialDaysLeft={bundle.trialDaysLeft}
    >
      <PageHeader
        title="Alérgenos"
        subtitle="Define los alérgenos del local UNA vez y márcalos en cada producto. El bot y la carta los muestran al cliente."
      />
      <AllergensEditor initialAllergens={initial} allItems={items} />
    </AppShell>
  );
}
