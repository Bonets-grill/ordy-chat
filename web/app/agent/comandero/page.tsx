// web/app/agent/comandero/page.tsx
//
// Comandero — el mesero humano toma pedidos en mesa desde su móvil/tablet.
// Server component: auth + tenant + onboarding gate → handoff al client board.

import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { auth } from "@/lib/auth";
import { requireTenant } from "@/lib/tenant";
import { ComanderoBoard } from "./comandero-board";

export const metadata = { title: "Comandero · Ordy Chat" };
export const dynamic = "force-dynamic";

export default async function ComanderoPage() {
  const session = await auth();
  if (!session) redirect("/signin?from=/agent/comandero");

  const bundle = await requireTenant();
  if (!bundle) redirect("/onboarding");

  return (
    <AppShell
      session={session}
      subscriptionStatus={bundle.tenant.subscriptionStatus}
      trialDaysLeft={bundle.trialDaysLeft}
    >
      <ComanderoBoard />
    </AppShell>
  );
}
