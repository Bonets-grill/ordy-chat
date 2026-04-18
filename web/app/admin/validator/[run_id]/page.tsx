// web/app/admin/validator/[run_id]/page.tsx — Detalle de un validator run.
// Sprint 3 validador-ui · Fase 8.

import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AdminAuthError, requireSuperAdmin } from "@/lib/admin/auth";
import { getFlag } from "@/lib/admin/flags";
import {
  getMessagesOfRun,
  getRunDetail,
  type ValidatorRunDetail,
} from "@/lib/admin/validator-queries";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { agentConfigs } from "@/lib/db/schema";
import { MessageCard } from "./message-card";
import { RunActionsHeader } from "./run-actions";

export const dynamic = "force-dynamic";

const STATUS_COLORS: Record<ValidatorRunDetail["status"], string> = {
  running: "bg-neutral-100 text-neutral-700",
  pass: "bg-emerald-100 text-emerald-700",
  review: "bg-amber-100 text-amber-700",
  fail: "bg-red-100 text-red-700",
  error: "bg-red-200 text-red-900",
};

async function resolveEffectiveMode(tenantId: string): Promise<"auto" | "manual" | "skip"> {
  const [cfg] = await db
    .select({ validationMode: agentConfigs.validationMode })
    .from(agentConfigs)
    .where(eq(agentConfigs.tenantId, tenantId))
    .limit(1);
  const override = cfg?.validationMode;
  if (override === "auto" || override === "manual" || override === "skip") {
    return override;
  }
  try {
    const global = await getFlag<"auto" | "manual" | "skip">("validation_mode_default");
    if (global === "auto" || global === "manual" || global === "skip") return global;
  } catch {
    // falla silenciosa → skip
  }
  return "skip";
}

export default async function ValidatorRunDetailPage({
  params,
}: {
  params: Promise<{ run_id: string }>;
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

  const { run_id } = await params;
  const run = await getRunDetail(run_id);
  if (!run) notFound();

  const [messages, effectiveMode] = await Promise.all([
    getMessagesOfRun(run_id),
    resolveEffectiveMode(run.tenantId),
  ]);

  return (
    <AppShell session={session}>
      <div className="space-y-6">
        <div>
          <Link
            href="/admin/validator"
            className="text-sm text-neutral-500 hover:text-neutral-900"
          >
            ← Validador
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {run.tenantName}{" "}
            <span className="text-neutral-400 text-base font-normal">/{run.tenantSlug}</span>
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-neutral-500">
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[run.status]}`}
            >
              {run.status}
            </span>
            <span>{run.triggeredBy}</span>
            <span>·</span>
            <span>{run.nicho}</span>
            <span>·</span>
            <span>{new Date(run.createdAt).toLocaleString("es-ES")}</span>
            <Badge tone="muted">modo efectivo: {effectiveMode}</Badge>
            {run.autopatchAttempts > 0 && (
              <Badge tone="warn">autopatch × {run.autopatchAttempts}</Badge>
            )}
            {run.pausedByThisRun && <Badge tone="warn">pausó agente</Badge>}
          </div>
        </div>

        <RunActionsHeader run={run} effectiveMode={effectiveMode} />

        {run.summary && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Summary</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-4">
              <div>
                <div className="text-xs text-neutral-500">Total</div>
                <div className="text-2xl font-semibold tabular-nums">{run.summary.total}</div>
              </div>
              <div>
                <div className="text-xs text-neutral-500">Pass</div>
                <div className="text-2xl font-semibold tabular-nums text-emerald-600">
                  {run.summary.passed}
                </div>
              </div>
              <div>
                <div className="text-xs text-neutral-500">Review</div>
                <div className="text-2xl font-semibold tabular-nums text-amber-600">
                  {run.summary.review}
                </div>
              </div>
              <div>
                <div className="text-xs text-neutral-500">Fail</div>
                <div className="text-2xl font-semibold tabular-nums text-red-600">
                  {run.summary.failed}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Mensajes ({messages.length})</h2>
          {messages.length === 0 ? (
            <div className="rounded-lg border border-neutral-200 bg-white p-6 text-sm text-neutral-500">
              Aún no hay mensajes registrados para este run.
            </div>
          ) : (
            messages.map((m) => (
              <MessageCard
                key={m.id}
                message={m}
                runId={run_id}
                canDecide={effectiveMode === "manual" && m.adminDecision === null}
              />
            ))
          )}
        </div>
      </div>
    </AppShell>
  );
}
