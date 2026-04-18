import { count, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getInstancesKpis, getOnboardingJobsKpis } from "@/lib/admin/queries";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { conversations, messages, tenants, users } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

export default async function AdminHome() {
  const session = await auth();
  if (!session) redirect("/signin?from=/admin");
  if (session.user.role !== "super_admin") redirect("/dashboard");

  const [
    tenantsCount,
    activeCount,
    trialingCount,
    usersCount,
    messagesCount,
    convsCount,
    onboardingKpis,
    instancesKpis,
  ] = await Promise.all([
    db.select({ n: count() }).from(tenants).then((r) => r[0]),
    db.select({ n: count() }).from(tenants).where(eq(tenants.subscriptionStatus, "active")).then((r) => r[0]),
    db.select({ n: count() }).from(tenants).where(eq(tenants.subscriptionStatus, "trialing")).then((r) => r[0]),
    db.select({ n: count() }).from(users).then((r) => r[0]),
    db.select({ n: count() }).from(messages).then((r) => r[0]),
    db.select({ n: count() }).from(conversations).then((r) => r[0]),
    getOnboardingJobsKpis(),
    getInstancesKpis(),
  ]);

  const recent = await db.select().from(tenants).orderBy(desc(tenants.createdAt)).limit(10);

  return (
    <AppShell session={session}>
      <div className="space-y-8">
        <header>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-semibold text-neutral-900">Super Admin</h1>
            <Badge tone="new">Owner</Badge>
          </div>
          <p className="mt-1 text-neutral-500">Panel global de la plataforma.</p>
        </header>

        <div className="grid gap-4 md:grid-cols-3">
          <Stat label="Tenants totales" value={tenantsCount?.n ?? 0} />
          <Stat label="Con suscripción activa" value={activeCount?.n ?? 0} />
          <Stat label="En trial" value={trialingCount?.n ?? 0} />
          <Stat label="Usuarios" value={usersCount?.n ?? 0} />
          <Stat label="Conversaciones totales" value={convsCount?.n ?? 0} />
          <Stat label="Mensajes totales" value={messagesCount?.n ?? 0} />
        </div>

        <div>
          <h2 className="text-lg font-semibold text-neutral-900">Operaciones (últimas 24h)</h2>
          <p className="text-sm text-neutral-500">Visibilidad del onboarding-fast + warm-up anti-ban.</p>
          <div className="mt-3 grid gap-4 md:grid-cols-4">
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
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Tenants recientes</CardTitle>
            <CardDescription>Los últimos 10 tenants creados.</CardDescription>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-100 text-left text-xs uppercase text-neutral-500">
                  <th className="py-2">Slug</th>
                  <th>Nombre</th>
                  <th>Estado</th>
                  <th>Trial vence</th>
                  <th>Creado</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((t) => (
                  <tr key={t.id} className="border-b border-neutral-50 last:border-0">
                    <td className="py-2 font-mono text-xs text-brand-600">{t.slug}</td>
                    <td>{t.name}</td>
                    <td><Badge tone={t.subscriptionStatus === "active" ? "success" : "warn"}>{t.subscriptionStatus}</Badge></td>
                    <td className="text-xs text-neutral-500">{new Date(t.trialEndsAt).toLocaleDateString("es-ES")}</td>
                    <td className="text-xs text-neutral-500">{new Date(t.createdAt).toLocaleDateString("es-ES")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <div className="flex flex-wrap gap-3">
          <Link href="/admin/tenants" className="inline-flex h-11 items-center rounded-full bg-neutral-900 px-5 text-sm font-medium text-white hover:bg-neutral-800">
            Tenants
          </Link>
          <Link href="/admin/onboarding-jobs" className="inline-flex h-11 items-center rounded-full border border-neutral-200 bg-white px-5 text-sm font-medium text-neutral-900 hover:bg-neutral-50">
            Onboarding jobs
          </Link>
          <Link href="/admin/instances" className="inline-flex h-11 items-center rounded-full border border-neutral-200 bg-white px-5 text-sm font-medium text-neutral-900 hover:bg-neutral-50">
            Instancias
          </Link>
          <Link href="/admin/flags" className="inline-flex h-11 items-center rounded-full border border-neutral-200 bg-white px-5 text-sm font-medium text-neutral-900 hover:bg-neutral-50">
            Feature flags
          </Link>
          <Link href="/admin/settings" className="inline-flex h-11 items-center rounded-full border border-neutral-200 bg-white px-5 text-sm font-medium text-neutral-900 hover:bg-neutral-50">
            API keys
          </Link>
        </div>
      </div>
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-3xl">{value}</CardTitle>
      </CardHeader>
    </Card>
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
  const accentClass =
    accent === "red" ? "text-red-700" : accent === "blue" ? "text-blue-700" : "text-neutral-900";
  return (
    <Link href={href} className="block">
      <Card className="hover:border-neutral-400 transition-colors">
        <CardHeader>
          <CardDescription>{label}</CardDescription>
          <CardTitle className={`text-3xl ${accentClass}`}>{value}</CardTitle>
        </CardHeader>
      </Card>
    </Link>
  );
}
