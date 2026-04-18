import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { KnowledgePanel } from "@/components/knowledge-panel";
import { auth } from "@/lib/auth";
import { requireTenant } from "@/lib/tenant";

export default async function KnowledgePage() {
  const session = await auth();
  if (!session) redirect("/signin?from=/agent/knowledge");

  const bundle = await requireTenant();
  if (!bundle) redirect("/onboarding");
  if (!bundle.config?.onboardingCompleted) redirect("/onboarding");

  return (
    <AppShell session={session} subscriptionStatus={bundle.tenant.subscriptionStatus} trialDaysLeft={bundle.trialDaysLeft}>
      <div className="space-y-8">
        <header>
          <h1 className="text-3xl font-semibold text-neutral-900">Conocimiento del agente</h1>
          <p className="mt-1 text-neutral-500">
            Todo lo que escribas aquí se usa en el system prompt del agente al instante. Corrige, añade o quita lo que haga falta.
          </p>
        </header>
        <KnowledgePanel />
      </div>
    </AppShell>
  );
}
