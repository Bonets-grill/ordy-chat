import { redirect } from "next/navigation";
import { ResellerShell } from "@/components/reseller-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShareCard } from "./share-card";
import { auth } from "@/lib/auth";
import { resellerKpis } from "@/lib/reseller/scope";

export const dynamic = "force-dynamic";

export default async function ResellerHome() {
  const session = await auth();
  if (!session) redirect("/signin?from=/reseller");
  if (session.user.role !== "reseller") redirect("/dashboard");

  const kpis = await resellerKpis(session);
  const { reseller } = kpis;

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://ordychat.ordysuite.com";
  const refUrl = `${baseUrl}/?ref=${reseller.slug}`;

  return (
    <ResellerShell session={session} resellerStatus={reseller.status}>
      <h1 className="text-3xl font-semibold text-neutral-900">
        Hola, {reseller.brandName}
      </h1>
      <p className="mt-1 text-neutral-500">Así va tu partnership este mes.</p>

      <div className="mt-6 grid gap-4 md:grid-cols-4">
        <KPI label="Tenants totales" value={String(kpis.tenantsTotal)} />
        <KPI label="Tenants activos" value={String(kpis.tenantsActive)} />
        <KPI label="Comisión pendiente" value={`€${(kpis.pendingCents / 100).toFixed(2)}`} />
        <KPI label="Comisión pagada" value={`€${(kpis.paidCents / 100).toFixed(2)}`} />
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Comparte tu enlace</CardTitle>
        </CardHeader>
        <CardContent>
          <ShareCard url={refUrl} />
          <p className="mt-3 text-xs text-neutral-500">
            Cada cliente que se registre vía este link queda atribuido a ti
            durante 90 días (cookie primera visita). Stripe Connect gestiona
            la moneda y el payout.
          </p>
        </CardContent>
      </Card>

      {reseller.status === "pending" && (
        <Card className="mt-6 border-amber-200 bg-amber-50">
          <CardContent className="p-4 text-sm text-amber-900">
            <strong>Cuenta pendiente.</strong> Conecta tu cuenta Stripe desde{" "}
            <a href="/reseller/settings" className="underline">
              Ajustes
            </a>{" "}
            para empezar a recibir comisiones.
          </CardContent>
        </Card>
      )}
    </ResellerShell>
  );
}

function KPI({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader>
        <p className="text-xs uppercase tracking-wide text-neutral-500">{label}</p>
        <CardTitle className="tabular-nums">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}
