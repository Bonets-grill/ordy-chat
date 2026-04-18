// web/app/admin/validator/page.tsx — Lista validator runs (super admin).
// Sprint 3 validador-ui · Fase 7.

import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AdminAuthError, requireSuperAdmin } from "@/lib/admin/auth";
import { auth } from "@/lib/auth";
import {
  getRuns,
  getRunsKpi24h,
  type ValidatorRunListItem,
  type ValidatorRunStatus,
} from "@/lib/admin/validator-queries";
import { Filters } from "./filters";

export const dynamic = "force-dynamic";

const STATUS_COLORS: Record<ValidatorRunStatus, string> = {
  running: "bg-neutral-100 text-neutral-700",
  pass: "bg-emerald-100 text-emerald-700",
  review: "bg-amber-100 text-amber-700",
  fail: "bg-red-100 text-red-700",
  error: "bg-red-200 text-red-900",
};

const ALLOWED_STATUSES: ValidatorRunStatus[] = ["running", "pass", "review", "fail", "error"];
const ALLOWED_SINCE = [24, 168, 720] as const;

function relativeTime(d: Date | string | null): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  const ms = Date.now() - date.getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `hace ${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h}h`;
  return `hace ${Math.floor(h / 24)}d`;
}

function renderSummary(s: ValidatorRunListItem["summary"]): string {
  if (!s) return "—";
  return `${s.passed}p / ${s.review}r / ${s.failed}f (${s.total})`;
}

export default async function AdminValidatorPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; tenant?: string; since?: string }>;
}) {
  try {
    await requireSuperAdmin();
  } catch (err) {
    if (err instanceof AdminAuthError) {
      redirect(err.code === "UNAUTHENTICATED" ? "/signin?from=/admin/validator" : "/dashboard");
    }
    throw err;
  }

  const session = await auth();
  if (!session) redirect("/signin?from=/admin/validator");

  const sp = await searchParams;
  const statusFilter = ALLOWED_STATUSES.includes(sp.status as ValidatorRunStatus)
    ? (sp.status as ValidatorRunStatus)
    : undefined;
  const sinceRaw = Number(sp.since);
  const sinceHours = ALLOWED_SINCE.includes(sinceRaw as (typeof ALLOWED_SINCE)[number])
    ? (sinceRaw as 24 | 168 | 720)
    : 168;
  const tenantSearch = sp.tenant?.trim() || undefined;

  const [runs, kpi] = await Promise.all([
    getRuns({ statusFilter, tenantSearch, sinceHours, limit: 100 }),
    getRunsKpi24h(),
  ]);

  return (
    <AppShell session={session}>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Validador</h1>
            <p className="text-sm text-neutral-500">
              Runs recientes del validador de agentes por tenant.
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-5">
          {(["running", "pass", "review", "fail", "error"] as ValidatorRunStatus[]).map((st) => (
            <Card key={st}>
              <CardContent className="p-4">
                <div className="text-xs uppercase tracking-wide text-neutral-500">{st} 24h</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">{kpi.byStatus[st]}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Filters defaultSince={sinceHours} defaultStatus={statusFilter} defaultTenant={tenantSearch ?? ""} />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Runs ({runs.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-neutral-100">
              {runs.length === 0 ? (
                <div className="p-6 text-sm text-neutral-500">
                  Sin runs con los filtros seleccionados.
                </div>
              ) : (
                runs.map((r) => (
                  <Link
                    key={r.id}
                    href={`/admin/validator/${r.id}`}
                    className="flex items-center justify-between gap-4 p-4 hover:bg-neutral-50"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{r.tenantName}</span>
                        <span className="text-xs text-neutral-500">/{r.tenantSlug}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-3 text-xs text-neutral-500">
                        <span>{r.triggeredBy}</span>
                        <span>·</span>
                        <span>{r.nicho}</span>
                        <span>·</span>
                        <span>{relativeTime(r.createdAt)}</span>
                        {r.autopatchAttempts > 0 && (
                          <>
                            <span>·</span>
                            <span>autopatch×{r.autopatchAttempts}</span>
                          </>
                        )}
                        {r.pausedByThisRun && (
                          <>
                            <span>·</span>
                            <Badge tone="warn">pausó agente</Badge>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="text-sm tabular-nums text-neutral-600">
                      {renderSummary(r.summary)}
                    </div>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[r.status]}`}
                    >
                      {r.status}
                    </span>
                  </Link>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
