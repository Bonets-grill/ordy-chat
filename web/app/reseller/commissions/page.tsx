import { redirect } from "next/navigation";
import { ResellerShell } from "@/components/reseller-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { getSessionReseller, resellerCommissionsList } from "@/lib/reseller/scope";

export const dynamic = "force-dynamic";

export default async function ResellerCommissionsPage() {
  const session = await auth();
  if (!session) redirect("/signin?from=/reseller/commissions");
  if (session.user.role !== "reseller") redirect("/dashboard");

  const reseller = await getSessionReseller(session);
  const rows = await resellerCommissionsList(session);

  const totals = rows.reduce(
    (acc, r) => {
      acc.all += r.commissionAmountCents;
      if (r.status === "paid") acc.paid += r.commissionAmountCents;
      else if (r.status === "pending" || r.status === "payable") acc.pending += r.commissionAmountCents;
      return acc;
    },
    { all: 0, paid: 0, pending: 0 },
  );

  return (
    <ResellerShell session={session} resellerStatus={reseller.status}>
      <h1 className="text-3xl font-semibold text-neutral-900">Comisiones</h1>
      <p className="mt-1 text-neutral-500">
        Una fila por factura Stripe pagada con atribución a tu slug.
      </p>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <p className="text-xs uppercase tracking-wide text-neutral-500">Total generado</p>
            <CardTitle>€{(totals.all / 100).toFixed(2)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <p className="text-xs uppercase tracking-wide text-neutral-500">Pendiente</p>
            <CardTitle>€{(totals.pending / 100).toFixed(2)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <p className="text-xs uppercase tracking-wide text-neutral-500">Pagado</p>
            <CardTitle>€{(totals.paid / 100).toFixed(2)}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{rows.length} comisiones</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-neutral-500">
              Aún sin comisiones. Aparecen cuando tus tenants pagan su factura mensual.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-100 text-left text-xs uppercase text-neutral-500">
                  <th className="py-2">Periodo</th>
                  <th>Factura</th>
                  <th className="text-right">Base</th>
                  <th className="text-right">Comisión</th>
                  <th>%</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-neutral-50 last:border-0">
                    <td className="py-2 text-xs">
                      {new Date(r.periodMonth).toLocaleDateString("es-ES", {
                        year: "numeric",
                        month: "short",
                      })}
                    </td>
                    <td className="font-mono text-xs text-neutral-500">
                      {r.stripeInvoiceId.slice(0, 12)}…
                    </td>
                    <td className="text-right tabular-nums">
                      {r.currency} {(r.baseAmountCents / 100).toFixed(2)}
                    </td>
                    <td className="text-right tabular-nums font-medium">
                      {r.currency} {(r.commissionAmountCents / 100).toFixed(2)}
                    </td>
                    <td className="text-xs text-neutral-500">
                      {(Number(r.commissionRateSnapshot) * 100).toFixed(1)}%
                    </td>
                    <td>
                      <Badge tone={statusTone(r.status)}>{r.status}</Badge>
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

function statusTone(status: string): "success" | "warn" | "muted" {
  if (status === "paid") return "success";
  if (status === "pending" || status === "payable") return "warn";
  return "muted";
}
