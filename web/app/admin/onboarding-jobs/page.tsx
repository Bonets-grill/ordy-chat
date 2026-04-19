// web/app/admin/onboarding-jobs/page.tsx — Lista de onboarding jobs (super admin).

import { desc, eq, inArray, and, gte } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AdminAuthError, requireSuperAdmin } from "@/lib/admin/auth";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { onboardingJobs, users } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-neutral-100 text-neutral-700",
  scraping: "bg-blue-100 text-blue-700",
  sources_ready: "bg-indigo-100 text-indigo-700",
  ready: "bg-amber-100 text-amber-700",
  confirming: "bg-amber-100 text-amber-800",
  done: "bg-emerald-100 text-emerald-700",
  failed: "bg-red-100 text-red-700",
};

const ALL_STATUSES = [
  "pending",
  "scraping",
  "sources_ready",
  "ready",
  "confirming",
  "done",
  "failed",
] as const;

function relativeTime(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const ms = Date.now() - date.getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h}h`;
  const days = Math.floor(h / 24);
  return `hace ${days}d`;
}

function urlsSummary(urls: unknown): string {
  if (!urls || typeof urls !== "object") return "—";
  const u = urls as Record<string, string>;
  const keys = Object.entries(u)
    .filter(([, v]) => typeof v === "string" && v.length > 0)
    .map(([k]) => k);
  return keys.length > 0 ? keys.join(" · ") : "—";
}

export default async function AdminOnboardingJobsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; since?: string }>;
}) {
  try {
    await requireSuperAdmin();
  } catch (err) {
    if (err instanceof AdminAuthError) {
      redirect(err.code === "UNAUTHENTICATED" ? "/signin?from=/admin/onboarding-jobs" : "/dashboard");
    }
    throw err;
  }
  const session = await auth();
  if (!session) redirect("/signin?from=/admin/onboarding-jobs");

  const params = await searchParams;
  const statusFilter = params.status && (ALL_STATUSES as readonly string[]).includes(params.status)
    ? params.status
    : null;
  const sinceHours = params.since === "168" ? 168 : params.since === "720" ? 720 : 24;
  const sinceDate = new Date(Date.now() - sinceHours * 60 * 60 * 1000);

  const conditions = [gte(onboardingJobs.createdAt, sinceDate)];
  if (statusFilter) {
    conditions.push(eq(onboardingJobs.status, statusFilter));
  }

  const rows = await db
    .select({
      id: onboardingJobs.id,
      status: onboardingJobs.status,
      urlsJson: onboardingJobs.urlsJson,
      error: onboardingJobs.error,
      createdAt: onboardingJobs.createdAt,
      userEmail: users.email,
    })
    .from(onboardingJobs)
    .innerJoin(users, eq(users.id, onboardingJobs.userId))
    .where(and(...conditions))
    .orderBy(desc(onboardingJobs.createdAt))
    .limit(50);

  return (
    <AdminShell session={session}>
      <div className="space-y-6">
        <header>
          <h1 className="text-3xl font-semibold text-neutral-900">Onboarding jobs</h1>
          <p className="mt-1 text-neutral-500">
            Jobs de scraping + merger del onboarding fast. Los activos (pending/scraping/sources_ready/
            confirming) tienen watchdog cada minuto.
          </p>
          <div className="mt-3 text-sm">
            <Link className="text-neutral-600 underline" href="/admin">
              ← Volver al panel
            </Link>
          </div>
        </header>

        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/onboarding-jobs"
            className={`rounded-full border px-3 py-1 text-xs ${!statusFilter ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 bg-white"}`}
          >
            Todos
          </Link>
          {ALL_STATUSES.map((s) => (
            <Link
              key={s}
              href={`/admin/onboarding-jobs?status=${s}${params.since ? `&since=${params.since}` : ""}`}
              className={`rounded-full border px-3 py-1 text-xs ${statusFilter === s ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 bg-white"}`}
            >
              {s}
            </Link>
          ))}
          <span className="ml-auto text-xs text-neutral-500">
            Últimas:{" "}
            <Link href={`/admin/onboarding-jobs?${statusFilter ? `status=${statusFilter}&` : ""}since=24`} className={sinceHours === 24 ? "font-semibold" : "underline"}>24h</Link>
            {" · "}
            <Link href={`/admin/onboarding-jobs?${statusFilter ? `status=${statusFilter}&` : ""}since=168`} className={sinceHours === 168 ? "font-semibold" : "underline"}>7d</Link>
            {" · "}
            <Link href={`/admin/onboarding-jobs?${statusFilter ? `status=${statusFilter}&` : ""}since=720`} className={sinceHours === 720 ? "font-semibold" : "underline"}>30d</Link>
          </span>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{rows.length} job{rows.length === 1 ? "" : "s"}</CardTitle>
          </CardHeader>
          <CardContent>
            {rows.length === 0 ? (
              <p className="text-sm text-neutral-500">Sin jobs en el rango seleccionado.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-100 text-left text-xs uppercase text-neutral-500">
                    <th className="py-2">Usuario</th>
                    <th>Fuentes</th>
                    <th>Estado</th>
                    <th>Creado</th>
                    <th>Error</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-neutral-50">
                      <td className="py-2 font-mono text-xs">{r.userEmail}</td>
                      <td>{urlsSummary(r.urlsJson)}</td>
                      <td>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[r.status] ?? "bg-neutral-100"}`}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td className="text-xs text-neutral-500">{relativeTime(r.createdAt)}</td>
                      <td className="max-w-xs truncate text-xs text-red-700" title={r.error ?? ""}>
                        {r.error ? r.error.slice(0, 60) : ""}
                      </td>
                      <td className="text-right">
                        <Link href={`/admin/onboarding-jobs/${r.id}`} className="text-sm underline">
                          detalle →
                        </Link>
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

// Silence unused (Badge importado si extendemos UI después).
void Badge;
