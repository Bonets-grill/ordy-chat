// web/app/dashboard/tpv/page.tsx
//
// Página de gestión TPV: lista lectores Stripe Terminal emparejados, permite
// emparejar uno nuevo y muestra el estado de Stripe Connect.
//
// Mig 045.

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { stripeTerminalReaders } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";
import { TpvBoard } from "./tpv-board";

export const dynamic = "force-dynamic";

export default async function TpvPage() {
  const session = await auth();
  if (!session) redirect("/signin?from=/dashboard/tpv");

  const bundle = await requireTenant();
  if (!bundle) redirect("/onboarding");

  const readers = await db
    .select()
    .from(stripeTerminalReaders)
    .where(eq(stripeTerminalReaders.tenantId, bundle.tenant.id));

  const initialReaders = readers.map((r) => ({
    id: r.id,
    readerId: r.readerId,
    label: r.label,
    serialNumber: r.serialNumber,
    status: r.status as "online" | "offline",
    lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
  }));

  return (
    <AppShell
      session={session}
      subscriptionStatus={bundle.tenant.subscriptionStatus}
      trialDaysLeft={bundle.trialDaysLeft}
    >
      <TpvBoard
        initialReaders={initialReaders}
        connected={Boolean(bundle.tenant.stripeAccountId)}
        accountId={bundle.tenant.stripeAccountId}
        locationId={bundle.tenant.stripeTerminalLocationId}
      />
    </AppShell>
  );
}
