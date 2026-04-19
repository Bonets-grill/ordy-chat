import { desc, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApproveButton } from "./approve-button";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { resellerPayouts, resellers } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export default async function AdminPayoutsPage() {
  const session = await auth();
  if (!session) redirect("/signin?from=/admin/payouts");
  if (session.user.role !== "super_admin") redirect("/dashboard");

  const rows = await db
    .select({
      payout: resellerPayouts,
      reseller: resellers,
    })
    .from(resellerPayouts)
    .innerJoin(resellers, eq(resellers.id, resellerPayouts.resellerId))
    .orderBy(desc(resellerPayouts.periodMonth), desc(resellerPayouts.createdAt))
    .limit(200);

  const [readyCount] = await db
    .select({ n: sql<number>`cast(count(*) as int)` })
    .from(resellerPayouts)
    .where(eq(resellerPayouts.status, "ready"));

  const [pendingTotal] = await db
    .select({
      s: sql<number>`coalesce(sum(${resellerPayouts.sourceTotalCents}), 0)::int`,
    })
    .from(resellerPayouts)
    .where(eq(resellerPayouts.status, "ready"));

  return (
    <AdminShell session={session}>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-neutral-900">Payouts</h1>
          <p className="mt-1 text-neutral-500">
            Aprobación manual requerida antes de mover dinero. Cron día 5 del mes.
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <p className="text-xs uppercase tracking-wide text-neutral-500">Listos para aprobar</p>
            <CardTitle>{readyCount?.n ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <p className="text-xs uppercase tracking-wide text-neutral-500">Importe pendiente</p>
            <CardTitle>€{((pendingTotal?.s ?? 0) / 100).toFixed(2)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <p className="text-xs uppercase tracking-wide text-neutral-500">Total histórico</p>
            <CardTitle>{rows.length}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{rows.length} payouts</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-neutral-500">
              Aún sin payouts. Se generan automáticamente el día 5 de cada mes.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-100 text-left text-xs uppercase text-neutral-500">
                  <th className="py-2">Periodo</th>
                  <th>Reseller</th>
                  <th>Estrategia</th>
                  <th>Estado</th>
                  <th className="text-right">Source €</th>
                  <th className="text-right">Transfer €</th>
                  <th>Currency</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ payout, reseller }) => {
                  const tb = payout.taxBreakdown as { transfer_cents?: number } | null;
                  const transferCents = tb?.transfer_cents ?? payout.sourceTotalCents;
                  return (
                    <tr key={payout.id} className="border-b border-neutral-50 last:border-0">
                      <td className="py-2 text-xs">
                        {new Date(payout.periodMonth).toLocaleDateString("es-ES", {
                          year: "numeric",
                          month: "short",
                        })}
                      </td>
                      <td>
                        <Link
                          href={`/admin/resellers/${reseller.id}`}
                          className="font-mono text-xs text-brand-600 hover:underline"
                        >
                          {reseller.slug}
                        </Link>
                      </td>
                      <td className="text-xs text-neutral-500">{reseller.taxStrategy}</td>
                      <td>
                        <Badge tone={payoutTone(payout.status)}>
                          {payout.status}
                          {payout.requiresHighValueApproval && payout.status === "ready" ? " ⚠ HV" : ""}
                        </Badge>
                      </td>
                      <td className="text-right tabular-nums">
                        €{(payout.sourceTotalCents / 100).toFixed(2)}
                      </td>
                      <td className="text-right tabular-nums">
                        €{(transferCents / 100).toFixed(2)}
                      </td>
                      <td className="text-xs">{payout.payoutCurrency}</td>
                      <td className="text-right">
                        {payout.status === "ready" && (
                          <ApproveButton
                            payoutId={payout.id}
                            highValue={payout.requiresHighValueApproval}
                          />
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
    </AdminShell>
  );
}

function payoutTone(status: string): "success" | "warn" | "muted" {
  if (status === "paid") return "success";
  if (status === "ready" || status === "sent") return "warn";
  return "muted";
}
