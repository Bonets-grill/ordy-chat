import { desc, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusButtons } from "./status-buttons";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  resellerCommissions,
  resellerPayouts,
  resellers,
  tenants,
  users,
} from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export default async function ResellerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/signin?from=/admin/resellers");
  if (session.user.role !== "super_admin") redirect("/dashboard");

  const { id } = await params;

  const [result] = await db
    .select({ reseller: resellers, owner: users })
    .from(resellers)
    .leftJoin(users, eq(users.id, resellers.userId))
    .where(eq(resellers.id, id))
    .limit(1);
  if (!result) notFound();

  const { reseller, owner } = result;

  const [tenantStats] = await db
    .select({
      n: sql<number>`cast(count(*) as int)`,
    })
    .from(tenants)
    .where(eq(tenants.resellerId, reseller.id));

  const [pending] = await db
    .select({ s: sql<number>`coalesce(sum(${resellerCommissions.commissionAmountCents}), 0)::int` })
    .from(resellerCommissions)
    .where(
      sql`${resellerCommissions.resellerId} = ${reseller.id} AND ${resellerCommissions.status} IN ('pending','payable')`,
    );

  const [paid] = await db
    .select({ s: sql<number>`coalesce(sum(${resellerCommissions.commissionAmountCents}), 0)::int` })
    .from(resellerCommissions)
    .where(
      sql`${resellerCommissions.resellerId} = ${reseller.id} AND ${resellerCommissions.status} = 'paid'`,
    );

  const recentTenants = await db
    .select({ id: tenants.id, slug: tenants.slug, name: tenants.name, status: tenants.subscriptionStatus, createdAt: tenants.createdAt })
    .from(tenants)
    .where(eq(tenants.resellerId, reseller.id))
    .orderBy(desc(tenants.createdAt))
    .limit(20);

  const recentPayouts = await db
    .select()
    .from(resellerPayouts)
    .where(eq(resellerPayouts.resellerId, reseller.id))
    .orderBy(desc(resellerPayouts.periodMonth))
    .limit(12);

  return (
    <AppShell session={session}>
      <Link href="/admin/resellers" className="text-xs text-neutral-500 hover:underline">
        ← Resellers
      </Link>
      <div className="mt-3 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-neutral-900">{reseller.brandName}</h1>
          <p className="mt-1 text-sm text-neutral-500">
            <span className="font-mono text-brand-600">{reseller.slug}</span>
            {" · "}
            {owner?.email ?? "(sin owner)"} · {reseller.countryCode} · {reseller.taxStrategy}
          </p>
        </div>
        <StatusButtons resellerId={reseller.id} currentStatus={reseller.status} />
      </div>

      <div className="mt-4">
        <Badge tone={reseller.status === "active" ? "success" : reseller.status === "pending" ? "warn" : "muted"}>
          {reseller.status}
        </Badge>
        {reseller.status === "pending" && (
          <span className="ml-2 text-xs text-amber-700">
            Esperando primer login y/o completar onboarding Stripe Connect.
          </span>
        )}
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-4">
        <KPI label="Tenants atribuidos" value={String(tenantStats?.n ?? 0)} />
        <KPI label="Comisión rate" value={`${(Number(reseller.commissionRate) * 100).toFixed(1)}%`} />
        <KPI label="Pendiente" value={`€${((pending?.s ?? 0) / 100).toFixed(2)}`} />
        <KPI label="Pagado" value={`€${((paid?.s ?? 0) / 100).toFixed(2)}`} />
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Tenants recientes ({recentTenants.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {recentTenants.length === 0 ? (
            <p className="py-6 text-center text-sm text-neutral-500">
              Aún sin tenants atribuidos.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-100 text-left text-xs uppercase text-neutral-500">
                  <th className="py-2">Slug</th>
                  <th>Negocio</th>
                  <th>Estado</th>
                  <th className="text-right">Alta</th>
                </tr>
              </thead>
              <tbody>
                {recentTenants.map((t) => (
                  <tr key={t.id} className="border-b border-neutral-50 last:border-0">
                    <td className="py-2 font-mono text-xs text-brand-600">{t.slug}</td>
                    <td>{t.name}</td>
                    <td>
                      <Badge tone={t.status === "active" ? "success" : "warn"}>{t.status}</Badge>
                    </td>
                    <td className="text-right text-xs text-neutral-500">
                      {new Date(t.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Payouts recientes ({recentPayouts.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {recentPayouts.length === 0 ? (
            <p className="py-6 text-center text-sm text-neutral-500">
              Sin payouts todavía. Se generan día 5 de cada mes.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-100 text-left text-xs uppercase text-neutral-500">
                  <th className="py-2">Periodo</th>
                  <th>Estado</th>
                  <th className="text-right">Source €</th>
                  <th className="text-right">Payout €</th>
                  <th>Moneda</th>
                </tr>
              </thead>
              <tbody>
                {recentPayouts.map((p) => (
                  <tr key={p.id} className="border-b border-neutral-50 last:border-0">
                    <td className="py-2">{new Date(p.periodMonth).toLocaleDateString("es-ES", { year: "numeric", month: "short" })}</td>
                    <td>
                      <Badge tone={p.status === "paid" ? "success" : p.status === "failed" ? "muted" : "warn"}>
                        {p.status}
                      </Badge>
                    </td>
                    <td className="text-right tabular-nums">€{(p.sourceTotalCents / 100).toFixed(2)}</td>
                    <td className="text-right tabular-nums">
                      {p.payoutTotalCents != null ? (p.payoutTotalCents / 100).toFixed(2) : "—"}
                    </td>
                    <td className="text-xs">{p.payoutCurrency}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}

function KPI({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader>
        <p className="text-xs uppercase tracking-wide text-neutral-500">{label}</p>
        <CardTitle className="tabular-nums">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}
