// /dashboard/ventas — reportes POS: por día y por turno.
import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { orders, shifts } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";
import { VentasTabs } from "./_tabs";

export const dynamic = "force-dynamic";

function euros(cents: number): string {
  return (cents / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

export default async function VentasPage() {
  const session = await auth();
  if (!session) redirect("/signin?from=/dashboard/ventas");
  const bundle = await requireTenant();
  if (!bundle) redirect("/onboarding");

  const tenantId = bundle.tenant.id;
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOf30 = new Date(Date.now() - 30 * 86_400_000);

  // Totales HOY (pagados).
  const [today] = await db
    .select({
      count: sql<number>`count(*)::int`,
      total: sql<number>`coalesce(sum(${orders.totalCents}), 0)::int`,
    })
    .from(orders)
    .where(and(
      eq(orders.tenantId, tenantId),
      eq(orders.isTest, false),
      isNotNull(orders.paidAt),
      gte(orders.paidAt, startOfDay),
    ));

  // Totales ESTE MES.
  const [month] = await db
    .select({
      count: sql<number>`count(*)::int`,
      total: sql<number>`coalesce(sum(${orders.totalCents}), 0)::int`,
    })
    .from(orders)
    .where(and(
      eq(orders.tenantId, tenantId),
      eq(orders.isTest, false),
      isNotNull(orders.paidAt),
      gte(orders.paidAt, startOfMonth),
    ));

  // Desglose por día, últimos 30.
  const byDay = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${orders.paidAt}), 'YYYY-MM-DD')`,
      count: sql<number>`count(*)::int`,
      total: sql<number>`coalesce(sum(${orders.totalCents}), 0)::int`,
    })
    .from(orders)
    .where(and(
      eq(orders.tenantId, tenantId),
      eq(orders.isTest, false),
      isNotNull(orders.paidAt),
      gte(orders.paidAt, startOf30),
    ))
    .groupBy(sql`date_trunc('day', ${orders.paidAt})`)
    .orderBy(sql`date_trunc('day', ${orders.paidAt}) desc`);

  // Histórico de turnos cerrados (últimos 30).
  const shiftRows = await db
    .select({
      id: shifts.id,
      openedAt: shifts.openedAt,
      closedAt: shifts.closedAt,
      openingCashCents: shifts.openingCashCents,
      countedCashCents: shifts.countedCashCents,
      orderCount: sql<number>`(
        SELECT count(*)::int FROM ${orders} o
        WHERE o.shift_id = ${shifts.id} AND o.is_test = false
      )`,
      paidCents: sql<number>`(
        SELECT coalesce(sum(o.total_cents), 0)::int FROM ${orders} o
        WHERE o.shift_id = ${shifts.id} AND o.is_test = false AND o.paid_at IS NOT NULL
      )`,
    })
    .from(shifts)
    .where(and(eq(shifts.tenantId, tenantId), isNotNull(shifts.closedAt)))
    .orderBy(desc(shifts.openedAt))
    .limit(30);

  return (
    <AppShell
      session={session}
      subscriptionStatus={bundle.tenant.subscriptionStatus}
      trialDaysLeft={bundle.trialDaysLeft}
    >
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-neutral-900">Ventas</h1>
          <p className="mt-1 text-neutral-500">Reporte POS por día y por turno.</p>
        </div>
        <Link href="/dashboard/turno" className="text-sm text-brand-600 hover:text-brand-700">→ Gestionar turno</Link>
      </div>

      <div className="mt-6">
        <VentasTabs active="/dashboard/ventas" />
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Stat label="Hoy" count={today?.count ?? 0} total={today?.total ?? 0} />
        <Stat label="Este mes" count={month?.count ?? 0} total={month?.total ?? 0} />
        <Stat
          label="Turnos cerrados (30d)"
          count={shiftRows.length}
          total={shiftRows.reduce((a, r) => a + r.paidCents, 0)}
        />
      </div>

      <Card className="mt-6">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Por día (últimos 30)</CardTitle>
          <a
            href="/api/reports/daily/export?days=30"
            download
            className="text-xs text-brand-600 hover:text-brand-700"
            title="Descargar CSV para contable/asesor"
          >
            📥 Exportar CSV
          </a>
        </CardHeader>
        <CardContent>
          {byDay.length === 0 ? (
            <p className="text-sm text-neutral-500">Aún no hay ventas en los últimos 30 días.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs font-medium uppercase tracking-wider text-neutral-500">
                  <th className="py-2">Día</th>
                  <th className="py-2 text-right">Pedidos</th>
                  <th className="py-2 text-right">Total</th>
                  <th className="py-2 text-right">Ticket medio</th>
                </tr>
              </thead>
              <tbody>
                {byDay.map((r) => (
                  <tr key={r.day} className="border-b border-neutral-100">
                    <td className="py-2 text-neutral-900">{new Date(r.day).toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" })}</td>
                    <td className="py-2 text-right font-variant-numeric tabular-nums">{r.count}</td>
                    <td className="py-2 text-right font-semibold font-variant-numeric tabular-nums text-neutral-900">{euros(r.total)}</td>
                    <td className="py-2 text-right text-neutral-500 font-variant-numeric tabular-nums">{euros(r.count > 0 ? Math.round(r.total / r.count) : 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Por turno</CardTitle>
          <a
            href="/api/reports/shifts/export?limit=100"
            download
            className="text-xs text-brand-600 hover:text-brand-700"
            title="Descargar CSV de turnos para contable/asesor"
          >
            📥 Exportar CSV
          </a>
        </CardHeader>
        <CardContent>
          {shiftRows.length === 0 ? (
            <p className="text-sm text-neutral-500">Aún no hay turnos cerrados. Abre uno desde <Link href="/dashboard/turno" className="text-brand-600">Turno POS</Link>.</p>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {shiftRows.map((r) => {
                const expected = r.openingCashCents + r.paidCents;
                const counted = r.countedCashCents;
                const diff = counted === null ? null : counted - expected;
                return (
                  <li key={r.id} className="py-3">
                    <Link href={`/dashboard/ventas/${r.id}`} className="block rounded-md -mx-2 px-2 py-1 hover:bg-neutral-50">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-neutral-900">
                            {new Date(r.openedAt).toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" })}
                            {r.closedAt && (
                              <span className="text-neutral-400"> → {new Date(r.closedAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</span>
                            )}
                          </div>
                          <div className="mt-0.5 text-xs text-neutral-500">
                            {r.orderCount} pedido{r.orderCount === 1 ? "" : "s"} · cobrado {euros(r.paidCents)}
                          </div>
                        </div>
                        <div className="text-right">
                          {diff === null ? (
                            <Badge tone="muted">sin cuadre</Badge>
                          ) : diff === 0 ? (
                            <Badge tone="success">cuadra</Badge>
                          ) : diff > 0 ? (
                            <Badge tone="success">+{euros(diff)}</Badge>
                          ) : (
                            <Badge tone="warn">{euros(diff)}</Badge>
                          )}
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}

function Stat({ label, count, total }: { label: string; count: number; total: number }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-neutral-900 font-variant-numeric tabular-nums">{euros(total)}</div>
      <div className="mt-0.5 text-xs text-neutral-500">{count} pedido{count === 1 ? "" : "s"}</div>
    </div>
  );
}
