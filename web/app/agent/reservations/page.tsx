// web/app/agent/reservations/page.tsx
// Listado de reservas/citas creadas por el agente. Server component:
// auth + tenant + onboarding gate → handoff al client.

import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { auth } from "@/lib/auth";
import { requireTenant } from "@/lib/tenant";
import { ReservationsList } from "./reservations-list";

export const metadata = { title: "Reservas — Ordy Chat" };

export default async function ReservationsPage() {
  const session = await auth();
  if (!session) redirect("/signin?from=/agent/reservations");

  const bundle = await requireTenant();
  if (!bundle) redirect("/onboarding");

  return (
    <AppShell
      session={session}
      subscriptionStatus={bundle.tenant.subscriptionStatus}
      trialDaysLeft={bundle.trialDaysLeft}
    >
      <ReservationsList timezone={bundle.tenant.timezone ?? "Europe/Madrid"} />
    </AppShell>
  );
}
