// web/app/agent/tables/plano/page.tsx
//
// Plano visual de mesas (mig 043). Renderiza el shell + carga inicial server-side.
// El cliente (mesa-canvas) hace drag-and-drop, edición y auto-refresh.

import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { auth } from "@/lib/auth";
import { requireTenant } from "@/lib/tenant";
import { MesaCanvas } from "./mesa-canvas";

export const dynamic = "force-dynamic";

export default async function PlanoPage() {
  const session = await auth();
  if (!session) redirect("/signin?from=/agent/tables/plano");
  const bundle = await requireTenant();
  if (!bundle) redirect("/onboarding");

  return (
    <AppShell
      session={session}
      subscriptionStatus={bundle.tenant.subscriptionStatus}
      trialDaysLeft={bundle.trialDaysLeft}
    >
      <div className="mx-auto max-w-7xl">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-semibold text-neutral-900">Plano de mesas</h1>
            <p className="mt-1 text-sm text-neutral-500">
              Arrastra las mesas para reproducir la disposición real del local. En
              modo vista los colores indican el estado en vivo.
            </p>
          </div>
          <div className="flex gap-2">
            <a
              href="/agent/tables"
              className="rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              Lista
            </a>
            <a
              href="/agent/tables/print"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700"
            >
              Imprimir QRs
            </a>
          </div>
        </header>

        <MesaCanvas tenantSlug={bundle.tenant.slug} />
      </div>
    </AppShell>
  );
}
