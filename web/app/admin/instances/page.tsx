// web/app/admin/instances/page.tsx — Lista de instancias (warm-up + burned).

import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AdminAuthError, requireSuperAdmin } from "@/lib/admin/auth";
import { getInstanceRows, type InstanceTier } from "@/lib/admin/queries";
import { auth } from "@/lib/auth";
import { UnburnButton } from "./unburn-button";

export const dynamic = "force-dynamic";

const TIER_COLORS: Record<InstanceTier, string> = {
  fresh: "bg-red-100 text-red-800",
  early: "bg-amber-100 text-amber-800",
  mid: "bg-yellow-100 text-yellow-800",
  mature: "bg-emerald-100 text-emerald-800",
};

const TIERS: InstanceTier[] = ["fresh", "early", "mid", "mature"];

export default async function AdminInstancesPage({
  searchParams,
}: {
  searchParams: Promise<{ tier?: string; burned?: string }>;
}) {
  try {
    await requireSuperAdmin();
  } catch (err) {
    if (err instanceof AdminAuthError) {
      redirect(err.code === "UNAUTHENTICATED" ? "/signin?from=/admin/instances" : "/dashboard");
    }
    throw err;
  }
  const session = await auth();
  if (!session) redirect("/signin?from=/admin/instances");

  const params = await searchParams;
  const tierFilter: InstanceTier | undefined = TIERS.includes(params.tier as InstanceTier)
    ? (params.tier as InstanceTier)
    : undefined;
  const burnedOnly = params.burned === "1";

  const rows = await getInstanceRows({
    tierFilter,
    burnedOnly: burnedOnly ? true : undefined,
    limit: 200,
  });

  return (
    <AdminShell session={session}>
      <div className="space-y-6">
        <header>
          <h1 className="text-3xl font-semibold text-neutral-900">Instancias WhatsApp</h1>
          <p className="mt-1 text-neutral-500">
            Estado de warm-up + burned por tenant. Caps diarios:{" "}
            <strong>fresh 0-3d → 30</strong>, <strong>early 4-7d → 100</strong>,{" "}
            <strong>mid 8-14d → 300</strong>, <strong>mature 15+ → sin cap</strong>.
          </p>
          <div className="mt-3 text-sm">
            <Link className="text-neutral-600 underline" href="/admin">
              ← Volver al panel
            </Link>
          </div>
        </header>

        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/instances"
            className={`rounded-full border px-3 py-1 text-xs ${!tierFilter && !burnedOnly ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 bg-white"}`}
          >
            Todas
          </Link>
          {TIERS.map((t) => (
            <Link
              key={t}
              href={`/admin/instances?tier=${t}${burnedOnly ? "&burned=1" : ""}`}
              className={`rounded-full border px-3 py-1 text-xs ${tierFilter === t ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 bg-white"}`}
            >
              {t}
            </Link>
          ))}
          <Link
            href={`/admin/instances?burned=1${tierFilter ? `&tier=${tierFilter}` : ""}`}
            className={`rounded-full border px-3 py-1 text-xs ${burnedOnly ? "border-red-500 bg-red-500 text-white" : "border-red-200 bg-white text-red-700"}`}
          >
            Solo burned
          </Link>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{rows.length} instancia{rows.length === 1 ? "" : "s"}</CardTitle>
          </CardHeader>
          <CardContent>
            {rows.length === 0 ? (
              <p className="text-sm text-neutral-500">Sin instancias en el filtro actual.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-100 text-left text-xs uppercase text-neutral-500">
                    <th className="py-2">Tenant</th>
                    <th>Provider</th>
                    <th>Edad</th>
                    <th>Tier</th>
                    <th>Msg hoy / cap</th>
                    <th>Estado</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.tenantId} className="border-b border-neutral-50">
                      <td className="py-2">
                        <div className="font-mono text-xs">{r.tenantSlug}</div>
                        <div className="text-xs text-neutral-500">{r.tenantName}</div>
                      </td>
                      <td className="text-xs">{r.provider}</td>
                      <td className="text-xs">{r.ageDays}d</td>
                      <td>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${TIER_COLORS[r.tier]}`}
                        >
                          {r.tier}
                        </span>
                      </td>
                      <td className="text-xs">
                        {r.msgHoy}
                        {r.cap !== null ? ` / ${r.cap}` : " / ∞"}
                        {r.cap !== null && r.msgHoy >= r.cap ? (
                          <span className="ml-1 rounded bg-red-100 px-1 text-red-700">cap</span>
                        ) : null}
                      </td>
                      <td>
                        {r.burned ? (
                          <span
                            className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700"
                            title={r.burnedReason ?? ""}
                          >
                            burned {r.burnedReason ? `· ${r.burnedReason}` : ""}
                          </span>
                        ) : (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                            activa
                          </span>
                        )}
                      </td>
                      <td className="text-right">
                        {r.burned ? <UnburnButton tenantId={r.tenantId} /> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminShell>
  );
}
