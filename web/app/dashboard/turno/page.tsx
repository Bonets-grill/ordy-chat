// /dashboard/turno — POS: apertura/cierre de turno con resumen vivo.
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { requireTenant } from "@/lib/tenant";
import { ShiftPanel } from "./shift-panel";

export const dynamic = "force-dynamic";

export default async function TurnoPage() {
  const session = await auth();
  if (!session) redirect("/signin?from=/dashboard/turno");
  const bundle = await requireTenant();
  if (!bundle) redirect("/onboarding");

  return (
    <AppShell
      session={session}
      subscriptionStatus={bundle.tenant.subscriptionStatus}
      trialDaysLeft={bundle.trialDaysLeft}
    >
      <div>
        <h1 className="text-3xl font-semibold text-neutral-900">Turno POS</h1>
        <p className="mt-1 text-neutral-500">
          Abre un turno al empezar y ciérralo al final para cuadrar caja.
          Los pedidos que entren mientras esté abierto se vinculan automáticamente.
        </p>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Turno actual</CardTitle>
        </CardHeader>
        <CardContent>
          <ShiftPanel />
        </CardContent>
      </Card>
    </AppShell>
  );
}
