import { desc, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  resellerCommissions,
  resellers,
  tenants,
  users,
} from "@/lib/db/schema";

export const dynamic = "force-dynamic";

type ResellerRow = {
  reseller: typeof resellers.$inferSelect;
  owner: typeof users.$inferSelect | null;
  tenantsCount: number;
  commissionsPendingCents: number;
  commissionsPaidCents: number;
};

export default async function AdminResellersPage() {
  const session = await auth();
  if (!session) redirect("/signin?from=/admin/resellers");
  if (session.user.role !== "super_admin") redirect("/dashboard");

  const rows = await db
    .select({ reseller: resellers, owner: users })
    .from(resellers)
    .leftJoin(users, eq(users.id, resellers.userId))
    .orderBy(desc(resellers.createdAt))
    .limit(200);

  // KPIs agregados por reseller (tenants count + commissions)
  const enriched: ResellerRow[] = await Promise.all(
    rows.map(async ({ reseller, owner }) => {
      const [tenantCount] = await db
        .select({ n: sql<number>`cast(count(*) as int)` })
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

      return {
        reseller,
        owner,
        tenantsCount: tenantCount?.n ?? 0,
        commissionsPendingCents: pending?.s ?? 0,
        commissionsPaidCents: paid?.s ?? 0,
      };
    }),
  );

  const totalActive = rows.filter((r) => r.reseller.status === "active").length;
  const totalTenants = enriched.reduce((a, b) => a + b.tenantsCount, 0);
  const totalPending = enriched.reduce((a, b) => a + b.commissionsPendingCents, 0);

  return (
    <AppShell session={session}>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-neutral-900">Resellers</h1>
          <p className="mt-1 text-neutral-500">
            Agencias y partners que revenden Ordy Chat. 25% comisión recurrente.
          </p>
        </div>
        <Link
          href="/admin/resellers/new"
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          + Nuevo reseller
        </Link>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Activos</CardDescription>
            <CardTitle>{totalActive}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Tenants atribuidos</CardDescription>
            <CardTitle>{totalTenants}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Comisión pendiente</CardDescription>
            <CardTitle>€{(totalPending / 100).toFixed(2)}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{rows.length} resellers</CardTitle>
        </CardHeader>
        <CardContent>
          {enriched.length === 0 ? (
            <div className="py-12 text-center text-neutral-500">
              <p>No hay resellers aún.</p>
              <Link
                href="/admin/resellers/new"
                className="mt-4 inline-block rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
              >
                Crear el primero
              </Link>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-100 text-left text-xs uppercase text-neutral-500">
                  <th className="py-2">Slug</th>
                  <th>Marca</th>
                  <th>País</th>
                  <th>Strategy</th>
                  <th>Estado</th>
                  <th className="text-right">Tenants</th>
                  <th className="text-right">Pending €</th>
                  <th className="text-right">Paid €</th>
                </tr>
              </thead>
              <tbody>
                {enriched.map((row) => (
                  <tr
                    key={row.reseller.id}
                    className="cursor-pointer border-b border-neutral-50 hover:bg-neutral-50 last:border-0"
                  >
                    <td className="py-2">
                      <Link
                        href={`/admin/resellers/${row.reseller.id}`}
                        className="font-mono text-xs text-brand-600 hover:underline"
                      >
                        {row.reseller.slug}
                      </Link>
                    </td>
                    <td>{row.reseller.brandName}</td>
                    <td className="text-xs text-neutral-500">{row.reseller.countryCode}</td>
                    <td className="text-xs text-neutral-500">{row.reseller.taxStrategy}</td>
                    <td>
                      <Badge tone={statusTone(row.reseller.status)}>{row.reseller.status}</Badge>
                    </td>
                    <td className="text-right text-xs tabular-nums">{row.tenantsCount}</td>
                    <td className="text-right text-xs tabular-nums">
                      €{(row.commissionsPendingCents / 100).toFixed(2)}
                    </td>
                    <td className="text-right text-xs tabular-nums">
                      €{(row.commissionsPaidCents / 100).toFixed(2)}
                    </td>
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

function statusTone(status: string): "success" | "warn" | "muted" {
  if (status === "active") return "success";
  if (status === "pending") return "warn";
  return "muted";
}
