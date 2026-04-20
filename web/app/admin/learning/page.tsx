// web/app/admin/learning/page.tsx
// Super admin review de reglas auto-aprendidas pendientes.
// Lista todas (pending+approved+rejected) con filtro. Botones approve/reject.

import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { AdminShell } from "@/components/admin-shell";
import { AdminAuthError, requireSuperAdmin } from "@/lib/admin/auth";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { LearningReview } from "./review-client";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  rule_text: string;
  evidence: string | null;
  suggested_priority: number;
  status: "pending" | "approved" | "rejected" | "superseded";
  reviewed_at: Date | string | null;
  created_at: Date | string;
};

async function loadRows(statusFilter: string | undefined): Promise<Row[]> {
  const allowed = new Set(["pending", "approved", "rejected"]);
  const filter = allowed.has(statusFilter ?? "") ? statusFilter : "pending";
  const raw = await db.execute(sql`
    SELECT
      lrp.id::text AS id,
      lrp.tenant_id::text AS tenant_id,
      t.name AS tenant_name,
      t.slug AS tenant_slug,
      lrp.rule_text,
      lrp.evidence,
      lrp.suggested_priority,
      lrp.status,
      lrp.reviewed_at,
      lrp.created_at
    FROM learned_rules_pending lrp
    JOIN tenants t ON t.id = lrp.tenant_id
    WHERE lrp.status = ${filter}
    ORDER BY lrp.created_at DESC
    LIMIT 100
  `);
  const rows = (Array.isArray(raw) ? raw : (raw as { rows?: unknown[] }).rows ?? []) as Row[];
  return rows;
}

async function loadCounts() {
  const raw = await db.execute(sql`
    SELECT status, count(*)::int AS n
    FROM learned_rules_pending
    GROUP BY status
  `);
  const rows = (Array.isArray(raw) ? raw : (raw as { rows?: unknown[] }).rows ?? []) as Array<{
    status: string;
    n: number;
  }>;
  const out: Record<string, number> = { pending: 0, approved: 0, rejected: 0 };
  for (const r of rows) out[r.status] = r.n;
  return out;
}

export default async function AdminLearningPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  try {
    await requireSuperAdmin();
  } catch (e) {
    if (e instanceof AdminAuthError) {
      redirect(e.code === "UNAUTHENTICATED" ? "/signin?from=/admin/learning" : "/dashboard");
    }
    throw e;
  }
  const session = await auth();
  if (!session) redirect("/signin?from=/admin/learning");

  const sp = await searchParams;
  const filter = sp.status ?? "pending";
  const [rows, counts] = await Promise.all([loadRows(filter), loadCounts()]);

  return (
    <AdminShell session={session}>
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-semibold text-neutral-900">Reglas aprendidas</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Propuestas que el cron diario extrae de las conversaciones reales.
            Aprueba para crear la regla en el agente del tenant.
          </p>
        </header>

        <div className="flex gap-2">
          {(["pending", "approved", "rejected"] as const).map((s) => (
            <a
              key={s}
              href={`/admin/learning?status=${s}`}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                filter === s
                  ? "border-neutral-900 bg-neutral-900 text-white"
                  : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-400"
              }`}
            >
              {s} ({counts[s] ?? 0})
            </a>
          ))}
        </div>

        <div className="space-y-3">
          {rows.length === 0 ? (
            <div className="rounded-xl border border-neutral-200 bg-white p-6 text-sm text-neutral-500">
              No hay reglas con este filtro.
            </div>
          ) : (
            rows.map((r) => (
              <LearningReview
                key={r.id}
                row={{
                  ...r,
                  created_at: typeof r.created_at === "string" ? r.created_at : r.created_at.toISOString(),
                  reviewed_at: r.reviewed_at
                    ? typeof r.reviewed_at === "string"
                      ? r.reviewed_at
                      : r.reviewed_at.toISOString()
                    : null,
                }}
              />
            ))
          )}
        </div>
      </div>
    </AdminShell>
  );
}
