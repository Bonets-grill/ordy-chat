// /dashboard/ventas/horas — Horas pico (mig 041).
// Server component. Lee orders pagados del período y agrega por hora 0-23.
// Marca top 3 horas como "hora pico".
import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";
import { readPeriodParam, VentasTabs } from "../_tabs";

export const dynamic = "force-dynamic";

function euros(cents: number): string {
  return (cents / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

export default async function HorasPicoPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/signin?from=/dashboard/ventas/horas");
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
      hour: sql<number>`extract(hour from ${orders.paidAt})::int`,
      count: sql<number>`count(*)::int`,
      totalCents: sql<number>`coalesce(sum(${orders.totalCents}), 0)::int`,
    })
    .from(orders)
    .where(and(
      eq(orders.tenantId, bundle.tenant.id),
      eq(orders.isTest, false),
      isNotNull(orders.paidAt),
      gte(orders.paidAt, since),
    ))
    .groupBy(sql`extract(hour from ${orders.paidAt})`)
    .orderBy(sql`extract(hour from ${orders.paidAt})`);

  // Densificar 0..23 con ceros para pintar todas las horas.
  const map = new Map(rows.map((r) => [r.hour, r]));
  const dense = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    count: map.get(h)?.count ?? 0,
    totalCents: map.get(h)?.totalCents ?? 0,
  }));
  const maxTotal = dense.reduce((m, h) => Math.max(m, h.totalCents), 0);

  // Top 3 horas con más revenue (ignora horas a 0). Si hay empate de 0 y nada
  // que mostrar, peakSet queda vacío.
  const peakSet = new Set(
    dense
      .filter((h) => h.totalCents > 0)
      .sort((a, b) => b.totalCents - a.totalCents)
      .slice(0, 3)
      .map((h) => h.hour),
  );

  const grandTotal = dense.reduce((a, h) => a + h.totalCents, 0);
  const grandCount = dense.reduce((a, h) => a + h.count, 0);

  return (
    <AppShell
      session={session}
      subscriptionStatus={bundle.tenant.subscriptionStatus}
      trialDaysLeft={bundle.trialDaysLeft}
    >
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-neutral-900">Horas pico</h1>
          <p className="mt-1 text-neutral-500">A qué hora del día vendes más.</p>
        </div>
        <Link href="/dashboard/turno" className="text-sm text-brand-600 hover:text-brand-700">→ Gestionar turno</Link>
      </div>

      <div className="mt-6">
        <VentasTabs active="/dashboard/ventas/horas" period={period} />
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Actividad por hora del día</CardTitle>
        </CardHeader>
        <CardContent>
          {grandCount === 0 ? (
            <p className="text-sm text-neutral-500">Aún no hay datos suficientes para mostrar horas pico.</p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-3 mb-4">
                <Stat label="Total cobrado" value={euros(grandTotal)} />
                <Stat label="Pedidos" value={String(grandCount)} />
                <Stat label="Horas pico" value={peakSet.size > 0 ? [...peakSet].sort((a, b) => a - b).map((h) => `${String(h).padStart(2, "0")}:00`).join(", ") : "—"} />
              </div>
              <ul className="space-y-1">
                {dense.map((h) => {
                  const isPeak = peakSet.has(h.hour);
                  const widthPct = maxTotal > 0 ? Math.max(0, (h.totalCents / maxTotal) * 100) : 0;
                  return (
                    <li key={h.hour} className="flex items-center gap-3 text-sm">
                      <span className="w-12 shrink-0 text-neutral-500 font-variant-numeric tabular-nums">
                        {String(h.hour).padStart(2, "0")}:00
                      </span>
                      <div className="relative h-4 flex-1 overflow-hidden rounded-sm bg-neutral-100">
                        <div
                          className={`absolute inset-y-0 left-0 rounded-sm ${
                            isPeak ? "bg-gradient-to-r from-amber-400 to-amber-500" : "bg-gradient-to-r from-brand-500 to-brand-600"
                          }`}
                          style={{ width: `${widthPct.toFixed(1)}%` }}
                        />
                      </div>
                      <span className="w-24 shrink-0 text-right font-variant-numeric tabular-nums text-neutral-700">
                        {h.totalCents > 0 ? euros(h.totalCents) : "—"}
                      </span>
                      <span className="w-10 shrink-0 text-right text-xs text-neutral-500">
                        {h.count > 0 ? h.count : ""}
                      </span>
                      {isPeak ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-800">
                          pico
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </>
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
