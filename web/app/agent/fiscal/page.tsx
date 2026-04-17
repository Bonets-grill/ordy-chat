import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { FiscalPanel } from "@/components/fiscal-panel";
import { auth } from "@/lib/auth";
import { requireTenant } from "@/lib/tenant";

export default async function FiscalPage() {
  const session = await auth();
  if (!session) redirect("/signin?from=/agent/fiscal");

  const bundle = await requireTenant();
  if (!bundle) redirect("/onboarding");
  if (!bundle.config?.onboardingCompleted) redirect("/onboarding");

  return (
    <AppShell session={session} subscriptionStatus={bundle.tenant.subscriptionStatus} trialDaysLeft={bundle.trialDaysLeft}>
      <div className="space-y-8">
        <header>
          <h1 className="text-3xl font-semibold text-neutral-900">Datos fiscales y branding</h1>
          <p className="mt-1 text-neutral-500">
            Configura la información que aparecerá en recibos y facturas que envíes a tus comensales.
          </p>
        </header>

        <FiscalPanel />
      </div>
    </AppShell>
  );
}
