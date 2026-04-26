// Server component — ajustes operativos del tenant.
// 2026-04-26: solo timezone por ahora. Sección "Cuenta" del sidebar.

import { redirect } from "next/navigation";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { requireTenant } from "@/lib/tenant";
import { TIMEZONES } from "@/lib/timezones";
import { TimezoneForm } from "./timezone-form";

export default async function AjustesPage() {
  const session = await auth();
  if (!session) redirect("/signin?from=/dashboard/ajustes");

  const bundle = await requireTenant();
  if (!bundle) redirect("/onboarding");

  return (
    <AppShell session={session}>
      <PageHeader
        title="Ajustes"
        subtitle="Configuración operativa del restaurante."
      />

      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Zona horaria</CardTitle>
            <CardDescription>
              La zona horaria afecta los reportes de ventas, el cuadre del turno
              y el cron que abre el turno automáticamente cuando entra el horario
              del restaurante.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TimezoneForm
              initialTimezone={bundle.tenant.timezone || "Europe/Madrid"}
              options={TIMEZONES.map((t) => ({ value: t.value, label: t.label, group: t.group }))}
            />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
