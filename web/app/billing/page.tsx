import { redirect } from "next/navigation";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { requireTenant } from "@/lib/tenant";
import { CheckoutButton } from "./checkout-button";

export default async function BillingPage() {
  const session = await auth();
  if (!session) redirect("/signin?from=/billing");
  const bundle = await requireTenant();
  if (!bundle) redirect("/onboarding");

  const statusMap: Record<string, string> = {
    trialing: "En periodo de prueba",
    active: "Suscripción activa",
    past_due: "Pago atrasado",
    canceled: "Cancelada",
    unpaid: "Sin pago",
  };

  return (
    <AppShell session={session} subscriptionStatus={bundle.tenant.subscriptionStatus} trialDaysLeft={bundle.trialDaysLeft}>
      <PageHeader
        title="Facturación"
        subtitle="Gestiona tu suscripción de €49.90/mes."
      />

      <Card>
        <CardHeader>
          <CardTitle>{statusMap[bundle.tenant.subscriptionStatus] ?? bundle.tenant.subscriptionStatus}</CardTitle>
          <CardDescription>
            {bundle.tenant.subscriptionStatus === "trialing"
              ? `Te quedan ${bundle.trialDaysLeft} días de prueba. Activa tu suscripción cuando quieras.`
              : bundle.tenant.subscriptionStatus === "active"
                ? "Todo en orden. Se renueva automáticamente."
                : "Activa tu suscripción para mantener el agente corriendo."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {bundle.tenant.subscriptionStatus !== "active" && <CheckoutButton />}
        </CardContent>
      </Card>
    </AppShell>
  );
}
