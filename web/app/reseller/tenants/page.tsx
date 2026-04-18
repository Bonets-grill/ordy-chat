import Link from "next/link";
import { redirect } from "next/navigation";
import { ResellerShell } from "@/components/reseller-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { getSessionReseller, resellerTenantsList } from "@/lib/reseller/scope";

export const dynamic = "force-dynamic";

export default async function ResellerTenantsPage() {
  const session = await auth();
  if (!session) redirect("/signin?from=/reseller/tenants");
  if (session.user.role !== "reseller") redirect("/dashboard");

  const reseller = await getSessionReseller(session);
  const tenants = await resellerTenantsList(session);

  return (
    <ResellerShell session={session} resellerStatus={reseller.status}>
      <h1 className="text-3xl font-semibold text-neutral-900">Tus tenants</h1>
      <p className="mt-1 text-neutral-500">
        Vista de solo lectura. No podemos mostrar email/teléfono por privacidad.
      </p>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{tenants.length} tenants atribuidos</CardTitle>
        </CardHeader>
        <CardContent>
          {tenants.length === 0 ? (
            <p className="py-6 text-center text-sm text-neutral-500">
              Aún sin tenants. Comparte tu enlace para empezar a ganar comisiones.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-100 text-left text-xs uppercase text-neutral-500">
                  <th className="py-2">Referencia</th>
                  <th>Estado suscripción</th>
                  <th>Trial hasta</th>
                  <th className="text-right">Alta</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((t) => (
                  <tr key={t.id} className="border-b border-neutral-50 last:border-0">
                    <td className="py-2 font-mono text-xs text-brand-600">{t.slug}</td>
                    <td>
                      <Badge tone={t.subscriptionStatus === "active" ? "success" : "warn"}>
                        {t.subscriptionStatus}
                      </Badge>
                    </td>
                    <td className="text-xs text-neutral-500">
                      {new Date(t.trialEndsAt).toLocaleDateString("es-ES")}
                    </td>
                    <td className="text-right text-xs text-neutral-500">
                      {new Date(t.createdAt).toLocaleDateString("es-ES")}
                    </td>
                    <td className="text-right">
                      <Link
                        href={`/reseller/tenants/${t.id}`}
                        className="text-xs text-brand-600 hover:underline"
                      >
                        Salud →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </ResellerShell>
  );
}
