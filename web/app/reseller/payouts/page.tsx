import { redirect } from "next/navigation";
import { ResellerShell } from "@/components/reseller-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { getSessionReseller, resellerPayoutsList } from "@/lib/reseller/scope";

export const dynamic = "force-dynamic";

type TaxBreakdown = {
  base_cents?: number;
  vat_rate?: number;
  vat_cents?: number;
  withholding_rate?: number;
  withholding_cents?: number;
  transfer_cents?: number;
};

export default async function ResellerPayoutsPage() {
  const session = await auth();
  if (!session) redirect("/signin?from=/reseller/payouts");
  if (session.user.role !== "reseller") redirect("/dashboard");

  const reseller = await getSessionReseller(session);
  const payouts = await resellerPayoutsList(session);

  return (
    <ResellerShell session={session} resellerStatus={reseller.status}>
      <h1 className="text-3xl font-semibold text-neutral-900">Payouts</h1>
      <p className="mt-1 text-neutral-500">
        Cobros mensuales vía Stripe Connect. Se generan el día 5 de cada mes.
      </p>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{payouts.length} payouts</CardTitle>
        </CardHeader>
        <CardContent>
          {payouts.length === 0 ? (
            <p className="py-6 text-center text-sm text-neutral-500">
              Sin payouts todavía. El primero se generará el día 5 del mes siguiente
              a tu primera comisión consolidada.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-100 text-left text-xs uppercase text-neutral-500">
                  <th className="py-2">Periodo</th>
                  <th>Estado</th>
                  <th className="text-right">Base €</th>
                  <th className="text-right">IVA €</th>
                  <th className="text-right">IRPF €</th>
                  <th className="text-right">Transferido</th>
                  <th>Factura</th>
                </tr>
              </thead>
              <tbody>
                {payouts.map((p) => {
                  const tb = (p.taxBreakdown ?? {}) as TaxBreakdown;
                  return (
                    <tr key={p.id} className="border-b border-neutral-50 last:border-0">
                      <td className="py-2">
                        {new Date(p.periodMonth).toLocaleDateString("es-ES", {
                          year: "numeric",
                          month: "short",
                        })}
                      </td>
                      <td>
                        <Badge
                          tone={
                            p.status === "paid"
                              ? "success"
                              : p.status === "failed"
                                ? "muted"
                                : "warn"
                          }
                        >
                          {p.status}
                        </Badge>
                      </td>
                      <td className="text-right text-xs tabular-nums">
                        {((tb.base_cents ?? p.sourceTotalCents) / 100).toFixed(2)}
                      </td>
                      <td className="text-right text-xs tabular-nums">
                        {((tb.vat_cents ?? 0) / 100).toFixed(2)}
                      </td>
                      <td className="text-right text-xs tabular-nums">
                        -{((tb.withholding_cents ?? 0) / 100).toFixed(2)}
                      </td>
                      <td className="text-right tabular-nums font-medium">
                        {p.payoutCurrency}{" "}
                        {p.payoutTotalCents != null
                          ? (p.payoutTotalCents / 100).toFixed(2)
                          : ((tb.transfer_cents ?? p.sourceTotalCents) / 100).toFixed(2)}
                      </td>
                      <td>
                        {p.invoicePdfUrl ? (
                          <a href={p.invoicePdfUrl} className="text-xs text-brand-600 hover:underline">
                            PDF
                          </a>
                        ) : (
                          <span className="text-xs text-neutral-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </ResellerShell>
  );
}
