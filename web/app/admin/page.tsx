import { count, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getInstancesKpis, getOnboardingJobsKpis } from "@/lib/admin/queries";
import { getRunsKpi24h } from "@/lib/admin/validator-queries";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { conversations, messages, tenants, users } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export default async function AdminHome() {
  const session = await auth();
  if (!session) redirect("/signin?from=/admin");
  if (session.user.role !== "super_admin") redirect("/dashboard");

  // DIAGNÓSTICO temporal: ejecuta cada query por separado para identificar
  // cuál falla. Se quita en cuanto identifique el bug del 500.
  const queries = [
    ["tenantsCount", () => db.select({ n: count() }).from(tenants).then((r) => r[0])],
    ["activeCount", () => db.select({ n: count() }).from(tenants).where(eq(tenants.subscriptionStatus, "active")).then((r) => r[0])],
    ["trialingCount", () => db.select({ n: count() }).from(tenants).where(eq(tenants.subscriptionStatus, "trialing")).then((r) => r[0])],
    ["usersCount", () => db.select({ n: count() }).from(users).then((r) => r[0])],
    ["messagesCount", () => db.select({ n: count() }).from(messages).then((r) => r[0])],
    ["convsCount", () => db.select({ n: count() }).from(conversations).then((r) => r[0])],
    ["onboardingKpis", () => getOnboardingJobsKpis()],
    ["instancesKpis", () => getInstancesKpis()],
    ["validatorKpi", () => getRunsKpi24h()],
    ["recentTenants", () => db.select().from(tenants).orderBy(desc(tenants.createdAt)).limit(10)],
  ] as const;

  const results: Record<string, unknown> = {};
  for (const [name, fn] of queries) {
    try {
      results[name] = await fn();
    } catch (err) {
      console.error(`[admin/page.tsx DIAG] FALLO en query "${name}":`, err);
      throw new Error(`admin diag · query="${name}" · ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const tenantsCount = results.tenantsCount as { n: number } | undefined;
  const activeCount = results.activeCount as { n: number } | undefined;
  const trialingCount = results.trialingCount as { n: number } | undefined;
  const usersCount = results.usersCount as { n: number } | undefined;
  const messagesCount = results.messagesCount as { n: number } | undefined;
  const convsCount = results.convsCount as { n: number } | undefined;
  const onboardingKpis = results.onboardingKpis as Awaited<ReturnType<typeof getOnboardingJobsKpis>>;
  const instancesKpis = results.instancesKpis as Awaited<ReturnType<typeof getInstancesKpis>>;
  const validatorKpi = results.validatorKpi as Awaited<ReturnType<typeof getRunsKpi24h>>;
  type TenantRow = typeof tenants.$inferSelect;
  const recent = results.recentTenants as TenantRow[];

  return (
    <AdminShell session={session}>
      <div className="space-y-10">
        <header className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-semibold text-neutral-900">Super Admin</h1>
              <Badge tone="new">Owner</Badge>
            </div>
            <p className="mt-1 text-sm text-neutral-500">Panel global de la plataforma.</p>
          </div>
          <Link
            href="/admin/assistant"
            className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            Asistente Opus 4.7 →
          </Link>
        </header>

        <section>
          <h2 className="mb-3 text-xs uppercase tracking-wide text-neutral-500">Plataforma</h2>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Tenants" value={tenantsCount?.n ?? 0} />
            <Stat label="Activos" value={activeCount?.n ?? 0} />
            <Stat label="En trial" value={trialingCount?.n ?? 0} />
            <Stat label="Usuarios" value={usersCount?.n ?? 0} />
            <Stat label="Conversaciones" value={convsCount?.n ?? 0} />
            <Stat label="Mensajes" value={messagesCount?.n ?? 0} />
          </div>
        </section>

        <section>
          <h2 className="mb-1 text-xs uppercase tracking-wide text-neutral-500">
            Operaciones (últimas 24h)
          </h2>
          <p className="mb-3 text-sm text-neutral-500">
            Onboarding fast + warm-up anti-ban + validador.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
            <StatLink
              label="Onboarding jobs 24h"
              value={Object.values(onboardingKpis.by_status).reduce((a, b) => a + b, 0)}
              href="/admin/onboarding-jobs"
              accent="neutral"
            />
            <StatLink
              label="Jobs activos"
              value={onboardingKpis.active_count}
              href="/admin/onboarding-jobs?status=scraping"
              accent={onboardingKpis.active_count > 0 ? "blue" : "neutral"}
            />
            <StatLink
              label="Jobs fallidos 24h"
              value={onboardingKpis.failed_24h}
              href="/admin/onboarding-jobs?status=failed"
              accent={onboardingKpis.failed_24h > 0 ? "red" : "neutral"}
            />
            <StatLink
              label="Instancias burned"
              value={instancesKpis.burnedCount}
              href="/admin/instances?burned=1"
              accent={instancesKpis.burnedCount > 0 ? "red" : "neutral"}
            />
            <StatLink
              label="Warm-up en curso"
              value={instancesKpis.warmupInCurso}
              href="/admin/instances"
              accent="neutral"
            />
            <StatLink
              label="Validator runs 24h"
              value={validatorKpi.total}
              href="/admin/validator"
              accent={validatorKpi.byStatus.fail > 0 ? "red" : "neutral"}
            />
            <StatLink
              label="Validator review 24h"
              value={validatorKpi.byStatus.review}
              href="/admin/validator?status=review"
              accent={validatorKpi.byStatus.review > 0 ? "blue" : "neutral"}
            />
            <StatLink
              label="Validator fail 24h"
              value={validatorKpi.byStatus.fail}
              href="/admin/validator?status=fail"
              accent={validatorKpi.byStatus.fail > 0 ? "red" : "neutral"}
            />
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-end justify-between">
            <div>
              <h2 className="text-xs uppercase tracking-wide text-neutral-500">
                Tenants recientes
              </h2>
              <p className="text-sm text-neutral-500">Los últimos 10 creados.</p>
            </div>
            <Link
              href="/admin/tenants"
              className="text-sm text-neutral-600 hover:text-neutral-900"
            >
              Ver todos →
            </Link>
          </div>
          <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50">
                <tr className="text-left text-xs uppercase text-neutral-500">
                  <th className="px-4 py-2.5 font-medium">Slug</th>
                  <th className="py-2.5 font-medium">Nombre</th>
                  <th className="py-2.5 font-medium">Estado</th>
                  <th className="py-2.5 font-medium">Trial</th>
                  <th className="py-2.5 font-medium">Creado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {recent.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-sm text-neutral-500">
                      Aún no hay tenants creados.
                    </td>
                  </tr>
                ) : (
                  recent.map((t) => (
                    <tr key={t.id} className="hover:bg-neutral-50">
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/admin/tenants/${t.id}`}
                          className="font-mono text-xs text-neutral-700 hover:underline"
                        >
                          {t.slug}
                        </Link>
                      </td>
                      <td className="py-2.5">{t.name}</td>
                      <td className="py-2.5">
                        <Badge tone={t.subscriptionStatus === "active" ? "success" : "warn"}>
                          {t.subscriptionStatus}
                        </Badge>
                      </td>
                      <td className="py-2.5 text-xs text-neutral-500">
                        {new Date(t.trialEndsAt).toLocaleDateString("es-ES")}
                      </td>
                      <td className="py-2.5 text-xs text-neutral-500">
                        {new Date(t.createdAt).toLocaleDateString("es-ES")}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AdminShell>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4">
      <div className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-neutral-900">
        {value}
      </div>
    </div>
  );
}

function StatLink({
  label,
  value,
  href,
  accent,
}: {
  label: string;
  value: number;
  href: string;
  accent: "neutral" | "blue" | "red";
}) {
  const tone =
    accent === "red"
      ? "border-red-200 bg-red-50 text-red-700"
      : accent === "blue"
      ? "border-blue-200 bg-blue-50 text-blue-700"
      : "border-neutral-200 bg-white text-neutral-900";
  return (
    <Link
      href={href}
      className={`block rounded-xl border p-4 transition-colors hover:border-neutral-400 ${tone}`}
    >
      <div className="text-[11px] uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </Link>
  );
}
