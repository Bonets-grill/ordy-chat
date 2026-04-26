// /dashboard/ventas/propinas — Reporte de propinas (mig 041).
// Server component. Total + num pedidos con propina + propina media + %
// sobre revenue. Si period=Nd, breakdown por día. Si period=shift:UUID,
// muestra propinas del turno (1 entrada).
import { and, eq, gt, gte, isNotNull, sql } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { orders, shifts } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";
import { readPeriodParam, VentasTabs } from "../_tabs";

export const dynamic = "force-dynamic";

function euros(cents: number): string {
  return (cents / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

export default async function PropinasPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; shift?: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/signin?from=/dashboard/ventas/propinas");
  const bundle = await requireTenant();
  if (!bundle) redirect("/onboarding");

  const sp = await searchParams;
  const period = readPeriodParam(sp.period);
  const shiftId = sp.shift && /^[0-9a-f-]{36}$/i.test(sp.shift) ? sp.shift : null;

  // Fix Mario 2026-04-26: TZ tenant para "hoy" + agrupados por día + excluir
  // canceled. Antes startOfDay usaba server UTC → desplazaba el día 1-2h.
  const tenantTz = bundle.tenant.timezone || "Atlantic/Canary";
  const tzLit = sql.raw(`'${tenantTz.replace(/'/g, "")}'`);

  const baseConds = [
    eq(orders.tenantId, bundle.tenant.id),
    eq(orders.isTest, false),
    sql`${orders.status} != 'canceled'`,
    isNotNull(orders.paidAt),
  ];

  let shiftMeta: { id: string; openedAt: Date; closedAt: Date | null } | null = null;
  let since: Date | null = null;

  if (shiftId) {
    const [s] = await db
      .select({ id: shifts.id, openedAt: shifts.openedAt, closedAt: shifts.closedAt })
      .from(shifts)
      .where(and(eq(shifts.id, shiftId), eq(shifts.tenantId, bundle.tenant.id)))
      .limit(1);
    if (!s) {
      // Si el shift no es del tenant, redirigimos al listado sin filtro para
      // no exponer enumeración de shifts ajenos.
      redirect("/dashboard/ventas/propinas");
    }
    shiftMeta = s;
    baseConds.push(eq(orders.shiftId, shiftId));
  } else {
    if (period === "today") {
      // Para "today" el bound es start_of_day en TZ tenant, no JS local.
      // since queda como aproximación informativa (1d antes) — el filtro
      // SQL real lo añadimos abajo con AT TIME ZONE.
      since = new Date(Date.now() - 86_400_000);
      baseConds.push(sql`${orders.paidAt} >= (date_trunc('day', NOW() AT TIME ZONE ${tzLit}) AT TIME ZONE ${tzLit})`);
    } else {
      since = period === "7d"
        ? new Date(Date.now() - 7 * 86_400_000)
        : new Date(Date.now() - 30 * 86_400_000);
      baseConds.push(gte(orders.paidAt, since));
    }
  }

  const [totalRow] = await db
    .select({
      tipCents: sql<number>`coalesce(sum(${orders.tipCents}), 0)::int`,
      ordersWithTip: sql<number>`count(*) FILTER (WHERE ${orders.tipCents} > 0)::int`,
      revenueCents: sql<number>`coalesce(sum(${orders.totalCents}), 0)::int`,
    })
    .from(orders)
    .where(and(...baseConds));

  const tipCents = totalRow?.tipCents ?? 0;
  const ordersWithTip = totalRow?.ordersWithTip ?? 0;
  const revenueCents = totalRow?.revenueCents ?? 0;
  const avgTipCents = ordersWithTip > 0 ? Math.round(tipCents / ordersWithTip) : 0;
  const tipPctOfRevenue = revenueCents > 0 ? (tipCents / revenueCents) * 100 : 0;

  // Solo si NO es shift, hacemos el breakdown por día.
  const byDay = shiftId
    ? []
    : await db
        .select({
          day: sql<string>`to_char(date_trunc('day', ${orders.paidAt} AT TIME ZONE ${tzLit}), 'YYYY-MM-DD')`,
          tipCents: sql<number>`coalesce(sum(${orders.tipCents}), 0)::int`,
          count: sql<number>`count(*)::int`,
        })
        .from(orders)
        .where(and(...baseConds, gt(orders.tipCents, 0)))
        .groupBy(sql`date_trunc('day', ${orders.paidAt} AT TIME ZONE ${tzLit})`)
        .orderBy(sql`date_trunc('day', ${orders.paidAt} AT TIME ZONE ${tzLit}) desc`);

  return (
    <AppShell
      session={session}
      subscriptionStatus={bundle.tenant.subscriptionStatus}
      trialDaysLeft={bundle.trialDaysLeft}
    >
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-neutral-900">Propinas</h1>
          <p className="mt-1 text-neutral-500">
            {shiftMeta
              ? `Turno ${new Date(shiftMeta.openedAt).toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" })}`
              : "Cuánto recibes en propinas, día a día."}
          </p>
        </div>
        <Link href="/dashboard/turno" className="text-sm text-brand-600 hover:text-brand-700">→ Gestionar turno</Link>
      </div>

      <div className="mt-6">
        <VentasTabs active="/dashboard/ventas/propinas" period={shiftId ? undefined : period} hidePeriodSwitcher={Boolean(shiftId)} />
      </div>

      {shiftId && shiftMeta ? (
        <p className="mt-3 text-xs text-neutral-500">
          Mostrando solo este turno. <Link href="/dashboard/ventas/propinas?period=30d" className="text-brand-600">Ver últimos 30 días</Link>
        </p>
      ) : null}

      <div className="mt-6 grid gap-3 sm:grid-cols-4">
        <Stat label="Total propinas" value={euros(tipCents)} highlight />
        <Stat label="Pedidos con propina" value={String(ordersWithTip)} />
        <Stat label="Propina media" value={euros(avgTipCents)} />
        <Stat label="% sobre cobrado" value={`${tipPctOfRevenue.toFixed(1)} %`} />
      </div>

      {!shiftId && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Por día</CardTitle>
          </CardHeader>
          <CardContent>
            {byDay.length === 0 ? (
              <p className="text-sm text-neutral-500">
                Aún no hay propinas registradas en este período. Cuando el camarero meta una propina al cobrar el pedido en el KDS, aparecerá aquí.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">
                    <th className="py-2">Día</th>
                    <th className="py-2 text-right">Pedidos</th>
                    <th className="py-2 text-right">Propinas</th>
                    <th className="py-2 text-right">Media</th>
                  </tr>
                </thead>
                <tbody>
                  {byDay.map((r) => (
                    <tr key={r.day} className="border-b border-neutral-100">
                      <td className="py-2 text-neutral-900">
                        {new Date(r.day).toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" })}
                      </td>
                      <td className="py-2 text-right font-variant-numeric tabular-nums">{r.count}</td>
                      <td className="py-2 text-right font-semibold font-variant-numeric tabular-nums text-neutral-900">{euros(r.tipCents)}</td>
                      <td className="py-2 text-right font-variant-numeric tabular-nums text-neutral-600">
                        {r.count > 0 ? euros(Math.round(r.tipCents / r.count)) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      )}
    </AppShell>
  );
}

function Stat({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border p-4 ${highlight ? "border-emerald-300 bg-emerald-50" : "border-neutral-200 bg-white"}`}>
      <div className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold font-variant-numeric tabular-nums ${highlight ? "text-emerald-900" : "text-neutral-900"}`}>{value}</div>
    </div>
  );
}
