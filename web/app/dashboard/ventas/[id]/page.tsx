// /dashboard/ventas/[id] — Detalle de un turno cerrado: cuadre de caja, top items, desglose horario.
import { and, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { orderItems, orders, shifts } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";

export const dynamic = "force-dynamic";

function euros(cents: number): string {
  return (cents / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

export default async function TurnoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) redirect("/signin?from=/dashboard/ventas");
  const bundle = await requireTenant();
  if (!bundle) redirect("/onboarding");

  const { id } = await params;

  const [shift] = await db
    .select()
    .from(shifts)
    .where(and(eq(shifts.id, id), eq(shifts.tenantId, bundle.tenant.id)))
    .limit(1);
  if (!shift) notFound();

  const [summary] = await db
    .select({
      count: sql<number>`count(*)::int`,
      paidCount: sql<number>`count(*) FILTER (WHERE ${orders.paidAt} IS NOT NULL)::int`,
      total: sql<number>`coalesce(sum(${orders.totalCents}), 0)::int`,
      paidTotal: sql<number>`coalesce(sum(${orders.totalCents}) FILTER (WHERE ${orders.paidAt} IS NOT NULL), 0)::int`,
      avgTicket: sql<number>`coalesce(avg(${orders.totalCents}) FILTER (WHERE ${orders.paidAt} IS NOT NULL), 0)::int`,
    })
    .from(orders)
    .where(and(eq(orders.shiftId, shift.id), eq(orders.isTest, false)));

  const topItems = await db
    .select({
      name: orderItems.name,
      quantity: sql<number>`sum(${orderItems.quantity})::int`,
      revenueCents: sql<number>`coalesce(sum(${orderItems.lineTotalCents}), 0)::int`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(eq(orders.shiftId, shift.id), eq(orders.isTest, false)))
    .groupBy(orderItems.name)
    .orderBy(sql`sum(${orderItems.quantity}) DESC`)
    .limit(10);

  const hourly = await db
    .select({
      hour: sql<number>`extract(hour from ${orders.createdAt})::int`,
      count: sql<number>`count(*)::int`,
      total: sql<number>`coalesce(sum(${orders.totalCents}), 0)::int`,
    })
    .from(orders)
    .where(and(eq(orders.shiftId, shift.id), eq(orders.isTest, false)))
    .groupBy(sql`extract(hour from ${orders.createdAt})`)
    .orderBy(sql`extract(hour from ${orders.createdAt})`);

  const s = summary ?? { count: 0, paidCount: 0, total: 0, paidTotal: 0, avgTicket: 0 };
  const expected = shift.openingCashCents + s.paidTotal;
  const diff = shift.countedCashCents === null ? null : shift.countedCashCents - expected;
  const maxHourTotal = hourly.reduce((m, h) => Math.max(m, h.total), 1);

  return (
    <AppShell
      session={session}
      subscriptionStatus={bundle.tenant.subscriptionStatus}
      trialDaysLeft={bundle.trialDaysLeft}
    >
      <div className="mb-6">
        <Link href="/dashboard/ventas" className="text-sm text-neutral-500 hover:text-neutral-900">← Ventas</Link>
        <h1 className="mt-2 text-3xl font-semibold text-neutral-900">
          Turno {new Date(shift.openedAt).toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" })}
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          {shift.closedAt
            ? `Cerrado ${new Date(shift.closedAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}`
            : "En curso"}
          {shift.openedBy && ` · abierto por ${shift.openedBy}`}
          {shift.closedBy && ` · cerrado por ${shift.closedBy}`}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Pedidos" value={String(s.count)} />
        <Stat label="Pagados" value={String(s.paidCount)} />
        <Stat label="Ticket medio" value={euros(s.avgTicket)} />
        <Stat label="Total cobrado" value={euros(s.paidTotal)} highlight />
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Cuadre de caja</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-4">
            <KV k="Caja inicial" v={euros(shift.openingCashCents)} />
            <KV k="Cobros efectivo" v={euros(s.paidTotal)} />
            <KV k="Esperado" v={euros(expected)} />
            <KV
              k="Contado"
              v={shift.countedCashCents === null ? "—" : euros(shift.countedCashCents)}
            />
          </div>
          <div className="mt-4">
            {diff === null ? (
              <Badge tone="muted">sin cuadre</Badge>
            ) : diff === 0 ? (
              <Badge tone="success">Cuadra perfecto</Badge>
            ) : diff > 0 ? (
              <Badge tone="success">+{euros(diff)} sobrante</Badge>
            ) : (
              <Badge tone="warn">{euros(diff)} faltante</Badge>
            )}
          </div>
          {shift.notes && (
            <p className="mt-3 text-sm text-neutral-600"><b>Notas:</b> {shift.notes}</p>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Top items</CardTitle>
        </CardHeader>
        <CardContent>
          {topItems.length === 0 ? (
            <p className="text-sm text-neutral-500">Sin items.</p>
          ) : (
            <ul className="space-y-2">
              {topItems.map((t) => (
                <li key={t.name} className="flex items-center justify-between text-sm">
                  <span className="text-neutral-900">{t.name}</span>
                  <span className="font-variant-numeric tabular-nums text-neutral-700">
                    {t.quantity}× · {euros(t.revenueCents)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Por hora</CardTitle>
        </CardHeader>
        <CardContent>
          {hourly.length === 0 ? (
            <p className="text-sm text-neutral-500">Sin actividad por hora.</p>
          ) : (
            <ul className="space-y-1">
              {hourly.map((h) => (
                <li key={h.hour} className="flex items-center gap-3 text-sm">
                  <span className="w-12 shrink-0 text-neutral-500 font-variant-numeric tabular-nums">{String(h.hour).padStart(2, "0")}:00</span>
                  <div className="relative h-4 flex-1 overflow-hidden rounded-sm bg-neutral-100">
                    <div
                      className="absolute inset-y-0 left-0 rounded-sm bg-gradient-to-r from-brand-500 to-brand-600"
                      style={{ width: `${Math.max(2, (h.total / maxHourTotal) * 100).toFixed(0)}%` }}
                    />
                  </div>
                  <span className="w-20 shrink-0 text-right font-variant-numeric tabular-nums text-neutral-700">{euros(h.total)}</span>
                  <span className="w-10 shrink-0 text-right text-xs text-neutral-500">{h.count}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}

function Stat({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border p-4 ${highlight ? "border-emerald-300 bg-emerald-50" : "border-neutral-200 bg-white"}`}>
      <div className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold font-variant-numeric tabular-nums ${highlight ? "text-emerald-900" : "text-neutral-900"}`}>{value}</div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">{k}</div>
      <div className="mt-0.5 text-base font-semibold text-neutral-900 font-variant-numeric tabular-nums">{v}</div>
    </div>
  );
}
