// web/app/agent/kds/page.tsx
// KDS (Kitchen Display System) — pantalla realtime para cocina y bar.
// Server component: auth + tenant + onboarding gate → handoff al client board.

import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { auth } from "@/lib/auth";
import { requireTenant } from "@/lib/tenant";
import { KdsBoard } from "./kds-board";

export const metadata = { title: "KDS — Cocina & Bar · Ordy Chat" };

export default async function KdsPage() {
  const session = await auth();
  if (!session) redirect("/signin?from=/agent/kds");

  const bundle = await requireTenant();
  if (!bundle) redirect("/onboarding");

  return (
    <AppShell
      session={session}
      subscriptionStatus={bundle.tenant.subscriptionStatus}
      trialDaysLeft={bundle.trialDaysLeft}
    >
      <KdsBoard />
    </AppShell>
  );
}
