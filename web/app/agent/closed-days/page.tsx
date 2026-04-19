import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { auth } from "@/lib/auth";
import { todayInTimezone } from "@/lib/agent/closed-days";
import { requireTenant } from "@/lib/tenant";
import { ClosedDaysCalendar } from "./ClosedDaysCalendar";

export const metadata = { title: "Días cerrados — Ordy Chat" };

export default async function ClosedDaysPage() {
  const session = await auth();
  if (!session) redirect("/signin?from=/agent/closed-days");

  const bundle = await requireTenant();
  if (!bundle) redirect("/onboarding");
  if (!bundle.config?.onboardingCompleted) redirect("/onboarding");

  const initialDates = bundle.config.reservationsClosedFor ?? [];
  const today = todayInTimezone(bundle.tenant.timezone);

  return (
    <AppShell
      session={session}
      subscriptionStatus={bundle.tenant.subscriptionStatus}
      trialDaysLeft={bundle.trialDaysLeft}
    >
      <div className="space-y-8">
        <header>
          <h1 className="text-3xl font-semibold text-neutral-900">Días cerrados</h1>
          <p className="mt-1 text-neutral-500">
            Marca los días en que <strong>no aceptas reservas nuevas</strong> (vacaciones, evento privado, aforo completo). El agente las aplica al instante en WhatsApp — sin tener que editar el prompt a mano.
          </p>
          <p className="mt-2 text-sm text-neutral-500">
            Zona horaria del negocio: <code className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs">{bundle.tenant.timezone}</code> · Hoy es <strong>{today}</strong>.
          </p>
        </header>

        <ClosedDaysCalendar initialDates={initialDates} today={today} />
      </div>
    </AppShell>
  );
}
