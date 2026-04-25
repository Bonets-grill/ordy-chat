// web/app/dashboard/ventas/meseros/page.tsx
//
// Reporte de ventas por mesero — agrega orders del comandero con
// metadata.created_by_waiter_id en el rango seleccionable.

import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { auth } from "@/lib/auth";
import { requireTenant } from "@/lib/tenant";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { employees, orders, users } from "@/lib/db/schema";
import { and, eq, gte, inArray, lt, or, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ventas por mesero · Ordy Chat" };

function fmtEur(cents: number) {
  return `${(cents / 100).toFixed(2).replace(".", ",")} €`;
}

type SearchParams = { from?: string; to?: string };

export default async function VentasMeserosPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await auth();
  if (!session) redirect("/signin?from=/dashboard/ventas/meseros");
  const bundle = await requireTenant();
  if (!bundle) redirect("/onboarding");

  const sp = await searchParams;
  const fromStr = /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? "")
    ? (sp.from as string)
    : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const toStr = /^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? "")
    ? (sp.to as string)
    : new Date().toISOString().slice(0, 10);
  const from = new Date(`${fromStr}T00:00:00.000Z`);
  const to = new Date(new Date(`${toStr}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000);

  // Coalescemos employee_id y waiter_id en un solo "actor key" para agrupar
  // (mig 049: el comandero ahora persiste created_by_employee_id; pre-mig
  // hay órdenes con created_by_waiter_id del flow owner-directo).
  const actorExpr = sql<string>`coalesce(
    ${orders.metadata} ->> 'created_by_employee_id',
    ${orders.metadata} ->> 'created_by_waiter_id'
  )`;
  const rows = await db
    .select({
      actorId: actorExpr,
      hasEmployee: sql<boolean>`(${orders.metadata} ? 'created_by_employee_id')`,
      orderCount: sql<number>`cast(count(*) as int)`,
      totalCents: sql<number>`coalesce(sum(${orders.totalCents}), 0)::int`,
      paidTotalCents: sql<number>`coalesce(sum(${orders.totalCents}) filter (where ${orders.status} = 'paid'), 0)::int`,
    })
    .from(orders)
    .where(
      and(
        eq(orders.tenantId, bundle.tenant.id),
        eq(orders.isTest, false),
        gte(orders.createdAt, from),
        lt(orders.createdAt, to),
        or(
          sql`${orders.metadata} ? 'created_by_waiter_id'`,
          sql`${orders.metadata} ? 'created_by_employee_id'`,
        ),
      ),
    )
    .groupBy(actorExpr, sql`(${orders.metadata} ? 'created_by_employee_id')`);

  const userRows = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users);
  const userMap = new Map(userRows.map((u) => [u.id, u]));

  const employeeIds = rows.filter((r) => r.hasEmployee && r.actorId).map((r) => r.actorId);
  const employeeRows = employeeIds.length
    ? await db
        .select({ id: employees.id, name: employees.name, role: employees.role })
        .from(employees)
        .where(inArray(employees.id, employeeIds))
    : [];
  const employeeMap = new Map(employeeRows.map((e) => [e.id, e]));

  const enriched = rows
    .map((r) => {
      if (r.hasEmployee) {
        const e = employeeMap.get(r.actorId);
        return {
          ...r,
          user: {
            email: e ? `(empleado · ${e.role})` : "(empleado eliminado)",
            name: e?.name ?? null,
          },
        };
      }
      return {
        ...r,
        user: userMap.get(r.actorId) ?? { email: "(usuario eliminado)", name: null },
      };
    })
    .sort((a, b) => b.paidTotalCents - a.paidTotalCents);

  const totalCount = enriched.reduce((s, r) => s + r.orderCount, 0);
  const totalPaid = enriched.reduce((s, r) => s + r.paidTotalCents, 0);

  return (
    <AppShell
      session={session}
      subscriptionStatus={bundle.tenant.subscriptionStatus}
      trialDaysLeft={bundle.trialDaysLeft}
    >
      <main className="mx-auto max-w-5xl px-6 py-8">
        <h1 className="text-3xl font-semibold text-neutral-900">Ventas por mesero</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Pedidos del comandero (no incluye bot WhatsApp ni web público).
        </p>

        <form method="get" className="mt-6 flex flex-wrap items-end gap-3">
          <label className="flex flex-col text-xs text-neutral-600">
            Desde
            <input
              type="date"
              name="from"
              defaultValue={fromStr}
              className="mt-1 rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col text-xs text-neutral-600">
            Hasta
            <input
              type="date"
              name="to"
              defaultValue={toStr}
              className="mt-1 rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
            />
          </label>
          <button
            type="submit"
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white"
          >
            Filtrar
          </button>
        </form>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>
              {enriched.length} mesero{enriched.length !== 1 ? "s" : ""} ·{" "}
              {totalCount} pedido{totalCount !== 1 ? "s" : ""} ·{" "}
              {fmtEur(totalPaid)} cobrado
            </CardTitle>
          </CardHeader>
          <CardContent>
            {enriched.length === 0 ? (
              <p className="py-6 text-center text-sm text-neutral-500">
                Aún no hay pedidos del comandero en este rango. Los meseros toman pedidos
                desde <a href="/agent/comandero" className="text-brand-600 hover:underline">/agent/comandero</a>.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-100 text-left text-xs uppercase text-neutral-500">
                    <th className="py-2">Mesero</th>
                    <th className="text-right">Pedidos</th>
                    <th className="text-right">Total</th>
                    <th className="text-right">Cobrado</th>
                  </tr>
                </thead>
                <tbody>
                  {enriched.map((r) => (
                    <tr key={r.actorId} className="border-b border-neutral-50 last:border-0">
                      <td className="py-2">
                        <div className="font-medium text-neutral-900">
                          {r.user.name ?? r.user.email}
                        </div>
                        {r.user.name ? (
                          <div className="text-xs text-neutral-500">{r.user.email}</div>
                        ) : null}
                      </td>
                      <td className="text-right tabular-nums">{r.orderCount}</td>
                      <td className="text-right tabular-nums">{fmtEur(r.totalCents)}</td>
                      <td className="text-right tabular-nums font-semibold">
                        {fmtEur(r.paidTotalCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </main>
    </AppShell>
  );
}
