import { count, desc, eq, sql } from "drizzle-orm";
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

// MRR estimado por tenant según plan (€/mes). Sync con pricing público.
// Si el tenant no tiene status active/trialing → 0.
function estimatedMrr(status: string | null): number {
  if (status === "active") return 49.9; // único plan público actualmente
  return 0;
}

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
    // Cockpit en vivo: pedidos hoy + mensajes 24h + último mensaje por tenant.
    // Una sola SQL agregada sobre 10 tenants top-by-createdAt.
    ["cockpit", () =>
      db.execute(sql`
        SELECT
          t.id,
          (SELECT count(*) FROM orders o
            WHERE o.tenant_id = t.id
              AND o.is_test = false
              AND o.status != 'canceled'
              AND o.paid_at IS NOT NULL
              AND o.paid_at >= (date_trunc('day', now() AT TIME ZONE COALESCE(t.timezone, 'Atlantic/Canary')) AT TIME ZONE COALESCE(t.timezone, 'Atlantic/Canary')))::int AS orders_today,
          (SELECT count(*) FROM messages m
            WHERE m.tenant_id = t.id
              AND m.created_at >= now() - interval '24 hours')::int AS messages_24h,
          (SELECT max(m.created_at) FROM messages m
            WHERE m.tenant_id = t.id) AS last_message_at
        FROM tenants t
        WHERE t.id IN (SELECT id FROM tenants ORDER BY created_at DESC LIMIT 10)
      `),
    ],
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
  type CockpitRow = { id: string; orders_today: number; messages_24h: number; last_message_at: string | null };
  const cockpitRaw = results.cockpit as { rows: CockpitRow[] } | CockpitRow[] | undefined;
  const cockpitArr: CockpitRow[] = Array.isArray(cockpitRaw)
    ? cockpitRaw
    : cockpitRaw?.rows ?? [];
  const cockpit = new Map<string, CockpitRow>(cockpitArr.map((r) => [r.id, r]));

  // Totales cockpit: MRR sumado + tenants en riesgo (trial expira <3d).
  const totalMrr = recent.reduce((s, t) => s + estimatedMrr(t.subscriptionStatus), 0);
  const trialExpiringSoon = recent.filter((t) => {
    if (t.subscriptionStatus !== "trialing") return false;
    const ms = new Date(t.trialEndsAt).getTime() - Date.now();
    return ms > 0 && ms < 3 * 24 * 60 * 60 * 1000;
  }).length;

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
          {/* Cockpit cards estilo Bloomberg — números XL tabular + delta sutil */}
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <div className="overflow-hidden rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-emerald-100/40 p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                  💰 MRR estimado
                </div>
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                  top 10
                </span>
              </div>
              <div className="mt-3 font-mono text-3xl font-bold tabular-nums tracking-tight text-emerald-900">
                {totalMrr.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
              </div>
              <div className="mt-1 text-[11px] text-emerald-700/80">
                Solo planes 'active' (49,90 €/mes/tenant)
              </div>
            </div>
            <div
              className={`overflow-hidden rounded-2xl border p-5 shadow-sm ${
                trialExpiringSoon > 0
                  ? "border-amber-200 bg-gradient-to-br from-amber-50 to-amber-100/40"
                  : "border-neutral-200 bg-white"
              }`}
            >
              <div className="flex items-center justify-between">
                <div
                  className={`text-[10px] font-semibold uppercase tracking-wider ${
                    trialExpiringSoon > 0 ? "text-amber-700" : "text-neutral-500"
                  }`}
                >
                  ⏰ Trials &lt; 3d
                </div>
                {trialExpiringSoon > 0 ? (
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                    acción
                  </span>
                ) : null}
              </div>
              <div
                className={`mt-3 font-mono text-3xl font-bold tabular-nums tracking-tight ${
                  trialExpiringSoon > 0 ? "text-amber-900" : "text-neutral-900"
                }`}
              >
                {trialExpiringSoon}
              </div>
              <div className={`mt-1 text-[11px] ${trialExpiringSoon > 0 ? "text-amber-700/80" : "text-neutral-500"}`}>
                {trialExpiringSoon > 0 ? "Contactar para upgrade" : "Sin trials cerca de expirar"}
              </div>
            </div>
            <div className="overflow-hidden rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 to-violet-100/40 p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-violet-700">
                  👥 Total tenants
                </div>
                <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-700">
                  top 10
                </span>
              </div>
              <div className="mt-3 font-mono text-3xl font-bold tabular-nums tracking-tight text-violet-900">
                {recent.length}
              </div>
              <div className="mt-1 text-[11px] text-violet-700/80">
                {recent.filter((t) => t.subscriptionStatus === "active").length} activos ·{" "}
                {recent.filter((t) => t.subscriptionStatus === "trialing").length} trial
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-gradient-to-r from-neutral-50 to-stone-50">
                <tr className="text-left text-[10px] font-semibold uppercase tracking-wider text-neutral-600">
                  <th className="px-4 py-3">Tenant</th>
                  <th className="py-3">Estado</th>
                  <th className="py-3 text-right">MRR</th>
                  <th className="py-3 text-right">Pedidos hoy</th>
                  <th className="py-3 text-right">Msgs 24h</th>
                  <th className="py-3">Salud</th>
                  <th className="px-4 py-3">Última actividad</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {recent.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-sm text-neutral-500">
                      Aún no hay tenants creados.
                    </td>
                  </tr>
                ) : (
                  recent.map((t) => {
                    const c = cockpit.get(t.id);
                    const ordersToday = c?.orders_today ?? 0;
                    const msgs24h = c?.messages_24h ?? 0;
                    const lastMs = c?.last_message_at ? new Date(c.last_message_at).getTime() : 0;
                    const minutesSince = lastMs ? Math.floor((Date.now() - lastMs) / 60000) : null;
                    const isExpired = t.subscriptionStatus !== "active" && t.subscriptionStatus !== "trialing";
                    const isStale = minutesSince === null || minutesSince > 60 * 24;
                    let health: { tone: "success" | "warn" | "danger" | "muted"; label: string } = { tone: "success", label: "OK" };
                    if (isExpired) health = { tone: "danger", label: "Expirado" };
                    else if (t.subscriptionStatus === "trialing") health = { tone: "warn", label: "Trial" };
                    else if (isStale) health = { tone: "warn", label: "Inactivo" };
                    const initial = (t.name ?? "?").trim().charAt(0).toUpperCase();
                    return (
                      <tr key={t.id} className="transition hover:bg-neutral-50/80">
                        <td className="px-4 py-3">
                          <Link href={`/admin/tenants/${t.id}`} className="flex items-center gap-3">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-violet-700 text-xs font-semibold text-white shadow-sm">
                              {initial}
                            </div>
                            <div className="min-w-0">
                              <div className="truncate font-semibold text-neutral-900">{t.name}</div>
                              <div className="truncate font-mono text-[10.5px] text-neutral-500">{t.slug}</div>
                            </div>
                          </Link>
                        </td>
                        <td className="py-3">
                          <Badge tone={t.subscriptionStatus === "active" ? "success" : "warn"}>
                            {t.subscriptionStatus}
                          </Badge>
                        </td>
                        <td className="py-3 text-right font-mono tabular-nums text-sm font-medium">
                          {estimatedMrr(t.subscriptionStatus).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
                        </td>
                        <td className="py-3 text-right">
                          <span className={`font-mono tabular-nums ${ordersToday > 0 ? "font-bold text-emerald-700" : "text-neutral-400"}`}>
                            {ordersToday}
                          </span>
                        </td>
                        <td className="py-3 text-right">
                          <span className={`font-mono tabular-nums ${msgs24h > 0 ? "font-semibold text-neutral-900" : "text-neutral-400"}`}>
                            {msgs24h}
                          </span>
                        </td>
                        <td className="py-3">
                          <Badge tone={health.tone}>{health.label}</Badge>
                        </td>
                        <td className="px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-neutral-500">
                          {minutesSince === null
                            ? "—"
                            : minutesSince < 60
                              ? `hace ${minutesSince}m`
                              : minutesSince < 60 * 24
                                ? `hace ${Math.floor(minutesSince / 60)}h`
                                : `hace ${Math.floor(minutesSince / (60 * 24))}d`}
                        </td>
                      </tr>
                    );
                  })
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
