import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { requireTenant } from "@/lib/tenant";
import { OnboardingWizard } from "./wizard";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ seed?: string; legacy?: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/signin?from=/onboarding");

  const bundle = await requireTenant();
  if (bundle?.config?.onboardingCompleted) {
    redirect("/dashboard");
  }

  const params = await searchParams;

  // Feature flag: redirect default al fast wizard si ONBOARDING_FAST_ENABLED=true
  // y el usuario no viene explícitamente con ?legacy=1 (escape hatch).
  if (process.env.ONBOARDING_FAST_ENABLED === "true" && params.legacy !== "1") {
    redirect("/onboarding/fast");
  }

  return (
    <div className="min-h-screen bg-surface-subtle">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-semibold text-neutral-900">Vamos a crear tu agente</h1>
          <p className="mt-2 text-neutral-500">
            10 preguntas rápidas. En menos de 5 minutos tu agente estará listo.
          </p>
        </div>
        <OnboardingWizard seed={params.seed ?? ""} />
      </div>
    </div>
  );
}
