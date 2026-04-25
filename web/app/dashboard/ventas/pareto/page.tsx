// /dashboard/ventas/pareto — Análisis 80/20 (mig 041).
// Server component. Calcula qué % de productos genera el 80% de las ventas.
// Lógica del cálculo en lib/reports/pareto.ts (testeada).
import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { orderItems, orders } from "@/lib/db/schema";
import { computePareto } from "@/lib/reports/pareto";
import { requireTenant } from "@/lib/tenant";
import { readPeriodParam, VentasTabs } from "../_tabs";

export const dynamic = "force-dynamic";

function euros(cents: number): string {
  return (cents / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

export default async function ParetoPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/signin?from=/dashboard/ventas/pareto");
  const bundle = await requireTenant();
  if (!bundle) redirect("/onboarding");

  const sp = await searchParams;
  const period = readPeriodParam(sp.period);

  const since = (() => {
    if (period === "today") {
      const now = new Date();
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }
    if (period === "7d") return new Date(Date.now() - 7 * 86_400_000);
    return new Date(Date.now() - 30 * 86_400_000);
  })();

  const items = await db
    .select({
      name: orderItems.name,
      revenueCents: sql<number>`coalesce(sum(${orderItems.lineTotalCents}), 0)::int`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(
      eq(orders.tenantId, bundle.tenant.id),
      eq(orders.isTest, false),
      isNotNull(orders.paidAt),
      gte(orders.paidAt, since),
    ))
    .groupBy(orderItems.name)
    .orderBy(sql`sum(${orderItems.lineTotalCents}) DESC`);

  const result = computePareto(items);

  return (
    <AppShell
      session={session}
      subscriptionStatus={bundle.tenant.subscriptionStatus}
      trialDaysLeft={bundle.trialDaysLeft}
    >
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-neutral-900">Análisis 80/20</h1>
          <p className="mt-1 text-neutral-500">El 20% de tus productos genera el 80% de las ventas. Identifica cuáles son.</p>
        </div>
        <Link href="/dashboard/turno" className="text-sm text-brand-600 hover:text-brand-700">→ Gestionar turno</Link>
      </div>

      <div className="mt-6">
        <VentasTabs active="/dashboard/ventas/pareto" period={period} />
      </div>

      {result.rows.length === 0 ? (
        <Card className="mt-6">
          <CardContent className="py-12 text-center">
            <p className="text-sm text-neutral-500">Aún no hay datos suficientes para calcular el Pareto. Necesitas al menos algunos pedidos pagados en el período.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="mt-6 border-emerald-200 bg-emerald-50/40">
            <CardContent className="py-5">
              <p className="text-sm text-emerald-900">
                <b>{result.paretoCount}</b> producto{result.paretoCount === 1 ? "" : "s"} ={" "}
                <b>~80% de tus ventas</b> ({euros(Math.round(result.totalRevenueCents * 0.8))} de {euros(result.totalRevenueCents)}).
              </p>
              <p className="mt-1 text-xs text-emerald-800/80">
                Eso es el <b>{result.paretoSharePct.toFixed(0)}%</b> de tu catálogo. Enfócate en estos: optimiza precios, asegura stock, ponlos arriba en la carta.
              </p>
            </CardContent>
          </Card>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Ranking con acumulado</CardTitle>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">
                    <th className="py-2">#</th>
                    <th className="py-2">Producto</th>
                    <th className="py-2 text-right">Revenue</th>
                    <th className="py-2 text-right">% individual</th>
                    <th className="py-2 text-right">% acumulado</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r, idx) => {
                    const indWidth = Math.min(100, r.sharePct);
                    const cumWidth = Math.min(100, r.cumulativePct);
                    return (
                      <tr
                        key={r.name}
                        className={`border-b border-neutral-100 ${
                          r.isParetoTop ? "bg-emerald-50/40" : ""
                        }`}
                      >
                        <td className="py-2 text-neutral-400 font-variant-numeric tabular-nums">
                          {idx + 1}
                          {r.isParetoTop ? <span className="ml-1 text-emerald-600" title="Pareto 80%">★</span> : null}
                        </td>
                        <td className="py-2 text-neutral-900">{r.name}</td>
                        <td className="py-2 text-right font-semibold font-variant-numeric tabular-nums text-neutral-900">{euros(r.revenueCents)}</td>
                        <td className="py-2 text-right">
                          <div className="inline-flex items-center gap-2">
                            <span className="font-variant-numeric tabular-nums text-neutral-700 w-12 text-right">{r.sharePct.toFixed(1)}%</span>
                            <div className="hidden sm:block h-2 w-16 overflow-hidden rounded-sm bg-neutral-100">
                              <div className="h-full bg-brand-500" style={{ width: `${indWidth.toFixed(1)}%` }} />
                            </div>
                          </div>
                        </td>
                        <td className="py-2 text-right">
                          <div className="inline-flex items-center gap-2">
                            <span className="font-variant-numeric tabular-nums text-neutral-700 w-12 text-right">{r.cumulativePct.toFixed(1)}%</span>
                            <div className="relative hidden sm:block h-2 w-20 overflow-hidden rounded-sm bg-neutral-100">
                              <div
                                className={`h-full ${r.isParetoTop ? "bg-emerald-500" : "bg-neutral-400"}`}
                                style={{ width: `${cumWidth.toFixed(1)}%` }}
                              />
                              {/* Marca punteada del 80% */}
                              <div className="absolute inset-y-0 border-l border-dashed border-emerald-700/60" style={{ left: "80%" }} aria-hidden="true" />
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </AppShell>
  );
}
