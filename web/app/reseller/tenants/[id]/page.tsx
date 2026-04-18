import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ResellerShell } from "@/components/reseller-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import {
  getSessionReseller,
  IDORError,
  resellerTenantById,
  resellerTenantHealth,
} from "@/lib/reseller/scope";

export const dynamic = "force-dynamic";

export default async function ResellerTenantDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/signin?from=/reseller");
  if (session.user.role !== "reseller") redirect("/dashboard");

  const reseller = await getSessionReseller(session);
  const { id } = await params;

  let tenant: Awaited<ReturnType<typeof resellerTenantById>>;
  let health: Awaited<ReturnType<typeof resellerTenantHealth>>;
  try {
    tenant = await resellerTenantById(session, id);
    health = await resellerTenantHealth(session, id);
  } catch (err) {
    if (err instanceof IDORError) notFound();
    throw err;
  }

  return (
    <ResellerShell session={session} resellerStatus={reseller.status}>
      <Link href="/reseller/tenants" className="text-xs text-neutral-500 hover:underline">
        ← Tenants
      </Link>
      <h1 className="mt-3 text-3xl font-semibold text-neutral-900 font-mono">{tenant.slug}</h1>

      <Card className="mt-4 border-blue-200 bg-blue-50">
        <CardContent className="p-4 text-sm text-blue-900">
          <strong>Vista de solo lectura.</strong> Si este cliente necesita
          soporte, dirígelo a contact@ordychat.ordysuite.com — tú no debes
          actuar sobre su cuenta.
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <p className="text-xs uppercase tracking-wide text-neutral-500">Estado suscripción</p>
            <CardTitle>
              <Badge tone={tenant.subscriptionStatus === "active" ? "success" : "warn"}>
                {tenant.subscriptionStatus}
              </Badge>
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <p className="text-xs uppercase tracking-wide text-neutral-500">Agente</p>
            <CardTitle className="text-base">
              {health.paused ? "⏸ Pausado" : "▶ Activo"}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <p className="text-xs uppercase tracking-wide text-neutral-500">Mensajes últimos 30d</p>
            <CardTitle className="tabular-nums">{health.messages30d}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Detalles</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            <span className="text-neutral-500">Trial termina:</span>{" "}
            {new Date(tenant.trialEndsAt).toLocaleDateString("es-ES")}
          </p>
          <p>
            <span className="text-neutral-500">Alta:</span>{" "}
            {new Date(tenant.createdAt).toLocaleDateString("es-ES")}
          </p>
          <p>
            <span className="text-neutral-500">Onboarding completado:</span>{" "}
            {health.onboardingCompleted ? "Sí" : "No"}
          </p>
        </CardContent>
      </Card>
    </ResellerShell>
  );
}
