// /dashboard/ventas/productos — Top productos (mig 041).
// Server component. Lee items vendidos en el período y los agrupa por nombre.
// Sirve qty + revenue + % del total. Botón export CSV.
import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { orderItems, orders } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";
import { readPeriodParam, VentasTabs } from "../_tabs";

export const dynamic = "force-dynamic";

function euros(cents: number): string {
  return (cents / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

export default async function TopProductosPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/signin?from=/dashboard/ventas/productos");
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

  const rows = await db
    .select({
      name: orderItems.name,
      quantity: sql<number>`sum(${orderItems.quantity})::int`,
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
    .orderBy(sql`sum(${orderItems.lineTotalCents}) DESC`)
    .limit(50);

  const totalRevenue = rows.reduce((a, r) => a + r.revenueCents, 0);
  const totalQty = rows.reduce((a, r) => a + r.quantity, 0);

  return (
    <AppShell
      session={session}
      subscriptionStatus={bundle.tenant.subscriptionStatus}
      trialDaysLeft={bundle.trialDaysLeft}
    >
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-neutral-900">Top productos</h1>
          <p className="mt-1 text-neutral-500">Los productos que más venden, por unidades y revenue.</p>
        </div>
        <Link href="/dashboard/turno" className="text-sm text-brand-600 hover:text-brand-700">→ Gestionar turno</Link>
      </div>

      <div className="mt-6">
        <VentasTabs active="/dashboard/ventas/productos" period={period} />
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Stat label="Productos" value={String(rows.length)} />
        <Stat label="Unidades vendidas" value={String(totalQty)} />
        <Stat label="Revenue total" value={euros(totalRevenue)} />
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Ranking por revenue</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-neutral-500">Aún no hay datos suficientes para este período.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">
                  <th className="py-2">#</th>
                  <th className="py-2">Producto</th>
                  <th className="py-2 text-right">Unidades</th>
                  <th className="py-2 text-right">Revenue</th>
                  <th className="py-2 text-right">% del total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => {
                  const sharePct = totalRevenue > 0 ? (r.revenueCents / totalRevenue) * 100 : 0;
                  return (
                    <tr key={r.name} className="border-b border-neutral-100">
                      <td className="py-2 text-neutral-400 font-variant-numeric tabular-nums">{idx + 1}</td>
                      <td className="py-2 text-neutral-900">{r.name}</td>
                      <td className="py-2 text-right font-variant-numeric tabular-nums">{r.quantity}</td>
                      <td className="py-2 text-right font-semibold font-variant-numeric tabular-nums text-neutral-900">{euros(r.revenueCents)}</td>
                      <td className="py-2 text-right font-variant-numeric tabular-nums text-neutral-600">{sharePct.toFixed(1)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">{label}</div>
      <div className="mt-1 text-xl font-semibold text-neutral-900 font-variant-numeric tabular-nums">{value}</div>
    </div>
  );
}
