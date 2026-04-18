import { redirect } from "next/navigation";
import { ResellerShell } from "@/components/reseller-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConnectStripeButton } from "./connect-button";
import { auth } from "@/lib/auth";
import { getSessionReseller } from "@/lib/reseller/scope";

export const dynamic = "force-dynamic";

export default async function ResellerSettingsPage() {
  const session = await auth();
  if (!session) redirect("/signin?from=/reseller/settings");
  if (session.user.role !== "reseller") redirect("/dashboard");

  const reseller = await getSessionReseller(session);

  return (
    <ResellerShell session={session} resellerStatus={reseller.status}>
      <h1 className="text-3xl font-semibold text-neutral-900">Ajustes</h1>

      <div className="mt-6 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Cuenta</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Marca">{reseller.brandName}</Row>
            <Row label="Slug">
              <span className="font-mono text-brand-600">{reseller.slug}</span>
            </Row>
            <Row label="País">{reseller.countryCode}</Row>
            <Row label="Moneda payout">{reseller.payoutCurrency}</Row>
            <Row label="Comisión">
              {(Number(reseller.commissionRate) * 100).toFixed(1)}%
            </Row>
            <Row label="Estado">
              <Badge
                tone={
                  reseller.status === "active"
                    ? "success"
                    : reseller.status === "pending"
                      ? "warn"
                      : "muted"
                }
              >
                {reseller.status}
              </Badge>
            </Row>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Stripe Connect (payout)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {reseller.stripeConnectAccountId ? (
              <>
                <Row label="Cuenta Connect">
                  <span className="font-mono text-xs">{reseller.stripeConnectAccountId}</span>
                </Row>
                <Row label="Estado">
                  <Badge
                    tone={
                      reseller.stripeConnectStatus === "active"
                        ? "success"
                        : reseller.stripeConnectStatus === "restricted" ||
                            reseller.stripeConnectStatus === "deauthorized"
                          ? "muted"
                          : "warn"
                    }
                  >
                    {reseller.stripeConnectStatus}
                  </Badge>
                </Row>
                <Row label="Payouts habilitados">
                  {reseller.stripeConnectPayoutsEnabled ? "Sí" : "No — pendiente KYC"}
                </Row>
                {reseller.stripeConnectStatus !== "active" && (
                  <ConnectStripeButton
                    label="Completar onboarding Stripe"
                    resellerId={reseller.id}
                  />
                )}
              </>
            ) : (
              <>
                <p className="text-neutral-500">
                  Para recibir comisiones necesitas conectar tu cuenta Stripe Express.
                  Stripe gestiona KYC y convierte EUR a tu moneda local.
                </p>
                <ConnectStripeButton label="Conectar Stripe" resellerId={reseller.id} />
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Datos fiscales</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Razón social">{reseller.legalName ?? "—"}</Row>
            <Row label="Tax ID">{reseller.taxId ?? "—"}</Row>
            <Row label="Tipo">{reseller.taxIdType ?? "—"}</Row>
            {reseller.countryCode === "ES" && (
              <>
                <Row label="Perfil fiscal">{reseller.fiscalSubProfile ?? "—"}</Row>
                <Row label="Alta IAE">{reseller.iaeRegistered ? "Sí" : "No"}</Row>
              </>
            )}
            <p className="pt-2 text-xs text-neutral-400">
              Cambios de datos fiscales los gestiona el super admin (contact@ordychat.ordysuite.com).
            </p>
          </CardContent>
        </Card>
      </div>
    </ResellerShell>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-neutral-100 py-1 last:border-0">
      <span className="text-neutral-500">{label}</span>
      <span className="font-medium">{children}</span>
    </div>
  );
}
