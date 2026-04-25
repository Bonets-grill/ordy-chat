// web/app/dashboard/modificadores/page.tsx
//
// Biblioteca de grupos de modificadores del tenant (mig 051). Reemplaza el
// modelo viejo donde había que crear los modificadores producto por producto
// dentro de /dashboard/carta. Ahora se crean UNA vez aquí y se asignan a N
// productos en bulk.

import { asc, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { AppShell, PageHeader } from "@/components/app-shell";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  menuItemModifierGroupLinks,
  menuItems,
  modifierGroups,
  modifierOptions,
} from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";
import { ModifierGroupsEditor } from "./modifier-groups-editor";

export const dynamic = "force-dynamic";

export default async function ModificadoresPage() {
  const session = await auth();
  if (!session) redirect("/signin?from=/dashboard/modificadores");
  const bundle = await requireTenant();
  if (!bundle) redirect("/onboarding");

  const groups = await db
    .select()
    .from(modifierGroups)
    .where(eq(modifierGroups.tenantId, bundle.tenant.id))
    .orderBy(asc(modifierGroups.sortOrder), asc(modifierGroups.name));

  const groupIds = groups.map((g) => g.id);
  const [options, links, items] = await Promise.all([
    groupIds.length
      ? db
          .select()
          .from(modifierOptions)
          .where(inArray(modifierOptions.groupId, groupIds))
          .orderBy(asc(modifierOptions.sortOrder), asc(modifierOptions.name))
      : Promise.resolve([] as Array<typeof modifierOptions.$inferSelect>),
    groupIds.length
      ? db
          .select({ groupId: menuItemModifierGroupLinks.groupId, menuItemId: menuItemModifierGroupLinks.menuItemId })
          .from(menuItemModifierGroupLinks)
          .where(inArray(menuItemModifierGroupLinks.groupId, groupIds))
      : Promise.resolve([] as Array<{ groupId: string; menuItemId: string }>),
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

  const optsByGroup = new Map<string, typeof options>();
  for (const o of options) {
    if (!optsByGroup.has(o.groupId)) optsByGroup.set(o.groupId, []);
    optsByGroup.get(o.groupId)!.push(o);
  }
  const itemsByGroup = new Map<string, string[]>();
  for (const l of links) {
    if (!itemsByGroup.has(l.groupId)) itemsByGroup.set(l.groupId, []);
    itemsByGroup.get(l.groupId)!.push(l.menuItemId);
  }

  // Narrow selectionType al unión literal porque Drizzle lo tipa como string.
  // El CHECK en DB garantiza el invariante.
  const initialGroups = groups.map((g) => ({
    ...g,
    selectionType: g.selectionType as "single" | "multi",
    options: optsByGroup.get(g.id) ?? [],
    assignedMenuItemIds: itemsByGroup.get(g.id) ?? [],
  }));

  return (
    <AppShell
      session={session}
      subscriptionStatus={bundle.tenant.subscriptionStatus}
      trialDaysLeft={bundle.trialDaysLeft}
    >
      <PageHeader
        title="Modificadores"
        subtitle="Crea grupos reusables (Tamaño, Extras, Quitar…) y asígnalos a varios productos a la vez."
      />
      <ModifierGroupsEditor initialGroups={initialGroups} allItems={items} />
    </AppShell>
  );
}
