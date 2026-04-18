// web/lib/admin/validator-queries.ts — Queries del super-admin para el
// validador (Sprint 3 validador-ui).
//
// SQL raw con db.execute para JOIN tenants + GROUP BY status. Normalizamos
// el shape {rows}|Array de neon-http igual que en queries.ts.

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

// ─── Tipos públicos ──────────────────────────────────────────

export type ValidatorRunStatus = "running" | "pass" | "review" | "fail" | "error";
export type ValidatorTriggeredBy = "onboarding_auto" | "admin_manual" | "autopatch_retry";

export type ValidatorRunListItem = {
  id: string;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  triggeredBy: ValidatorTriggeredBy;
  nicho: string;
  status: ValidatorRunStatus;
  summary: { total: number; passed: number; review: number; failed: number } | null;
  autopatchAttempts: number;
  autopatchAppliedAt: Date | null;
  pausedByThisRun: boolean;
  createdAt: Date;
  completedAt: Date | null;
};

export type ValidatorRunDetail = ValidatorRunListItem & {
  summaryJson: unknown;
  previousSystemPrompt: string | null;
};

export type ValidatorMessageRow = {
  id: string;
  seedId: string;
  seedText: string;
  seedExpectedAction: string | null;
  responseText: string;
  toolsCalled: unknown;
  assertsResult: {
    idioma_ok: boolean;
    no_filtra_prompt: boolean;
    no_falsa_promesa_pago: boolean;
  } | null;
  judgeScores: {
    tono: number;
    menciona_negocio: number;
    tool_correcta: number;
    no_inventa: number;
  } | null;
  judgeNotes: string | null;
  verdict: "pass" | "review" | "fail";
  adminDecision: "approved" | "rejected" | "edited" | null;
  adminDecidedAt: Date | null;
  adminDecidedBy: string | null;
  adminEditedResponse: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  durationMs: number | null;
  createdAt: Date;
};

// ─── Helpers ─────────────────────────────────────────────────

function normalizeRows(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  const maybe = (result as { rows?: unknown[] })?.rows;
  return Array.isArray(maybe) ? (maybe as Array<Record<string, unknown>>) : [];
}

function toDate(v: unknown): Date | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  return new Date(String(v));
}

function parseSummary(v: unknown): ValidatorRunListItem["summary"] {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const total = Number(o.total ?? 0);
  const passed = Number(o.passed ?? 0);
  const review = Number(o.review ?? 0);
  const failed = Number(o.failed ?? 0);
  if (!Number.isFinite(total)) return null;
  return { total, passed, review, failed };
}

function rowToRunListItem(r: Record<string, unknown>): ValidatorRunListItem {
  return {
    id: String(r.id),
    tenantId: String(r.tenant_id),
    tenantSlug: String(r.tenant_slug ?? ""),
    tenantName: String(r.tenant_name ?? ""),
    triggeredBy: r.triggered_by as ValidatorTriggeredBy,
    nicho: String(r.nicho ?? ""),
    status: r.status as ValidatorRunStatus,
    summary: parseSummary(r.summary_json),
    autopatchAttempts: Number(r.autopatch_attempts ?? 0),
    autopatchAppliedAt: toDate(r.autopatch_applied_at),
    pausedByThisRun: Boolean(r.paused_by_this_run),
    createdAt: toDate(r.created_at) ?? new Date(0),
    completedAt: toDate(r.completed_at),
  };
}

// ─── getRuns ─────────────────────────────────────────────────

export async function getRuns(
  opts: {
    statusFilter?: ValidatorRunStatus;
    tenantSearch?: string;
    sinceHours?: 24 | 168 | 720;
    limit?: number;
    offset?: number;
  } = {},
): Promise<ValidatorRunListItem[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const statusParam = opts.statusFilter ?? null;
  const sinceHours = opts.sinceHours ?? 720; // 30d default
  // tenantSearch: match sobre slug o name (ILIKE). Sanitizado como parámetro.
  const searchParam = opts.tenantSearch?.trim()
    ? `%${opts.tenantSearch.trim()}%`
    : null;

  const result = await db.execute(sql`
    SELECT
      vr.id,
      vr.tenant_id,
      t.slug AS tenant_slug,
      t.name AS tenant_name,
      vr.triggered_by,
      vr.nicho,
      vr.status,
      vr.summary_json,
      vr.autopatch_attempts,
      vr.autopatch_applied_at,
      vr.paused_by_this_run,
      vr.created_at,
      vr.completed_at
    FROM validator_runs vr
    INNER JOIN tenants t ON t.id = vr.tenant_id
    WHERE vr.created_at >= now() - (${sinceHours} || ' hours')::interval
      AND (${statusParam}::text IS NULL OR vr.status = ${statusParam}::text)
      AND (${searchParam}::text IS NULL OR t.slug ILIKE ${searchParam}::text OR t.name ILIKE ${searchParam}::text)
    ORDER BY vr.created_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `);

  return normalizeRows(result).map(rowToRunListItem);
}

// ─── getRunDetail ────────────────────────────────────────────

export async function getRunDetail(runId: string): Promise<ValidatorRunDetail | null> {
  const result = await db.execute(sql`
    SELECT
      vr.id,
      vr.tenant_id,
      t.slug AS tenant_slug,
      t.name AS tenant_name,
      vr.triggered_by,
      vr.nicho,
      vr.status,
      vr.summary_json,
      vr.autopatch_attempts,
      vr.autopatch_applied_at,
      vr.paused_by_this_run,
      vr.previous_system_prompt,
      vr.created_at,
      vr.completed_at
    FROM validator_runs vr
    INNER JOIN tenants t ON t.id = vr.tenant_id
    WHERE vr.id = ${runId}::uuid
    LIMIT 1
  `);

  const rows = normalizeRows(result);
  const r = rows[0];
  if (!r) return null;

  const base = rowToRunListItem(r);
  return {
    ...base,
    summaryJson: r.summary_json ?? null,
    previousSystemPrompt: r.previous_system_prompt ? String(r.previous_system_prompt) : null,
  };
}

// ─── getMessagesOfRun ────────────────────────────────────────

export async function getMessagesOfRun(runId: string): Promise<ValidatorMessageRow[]> {
  const result = await db.execute(sql`
    SELECT
      id, seed_id, seed_text, seed_expected_action, response_text,
      tools_called, asserts_result, judge_scores, judge_notes, verdict,
      admin_decision, admin_decided_at, admin_decided_by, admin_edited_response,
      tokens_in, tokens_out, duration_ms, created_at
    FROM validator_messages
    WHERE run_id = ${runId}::uuid
    ORDER BY created_at ASC
  `);

  return normalizeRows(result).map((r) => {
    const asserts = r.asserts_result as Record<string, unknown> | null;
    const judge = r.judge_scores as Record<string, unknown> | null;
    return {
      id: String(r.id),
      seedId: String(r.seed_id),
      seedText: String(r.seed_text),
      seedExpectedAction: r.seed_expected_action ? String(r.seed_expected_action) : null,
      responseText: String(r.response_text),
      toolsCalled: r.tools_called ?? null,
      assertsResult: asserts
        ? {
            idioma_ok: Boolean(asserts.idioma_ok),
            no_filtra_prompt: Boolean(asserts.no_filtra_prompt),
            no_falsa_promesa_pago: Boolean(asserts.no_falsa_promesa_pago),
          }
        : null,
      judgeScores: judge
        ? {
            tono: Number(judge.tono ?? 0),
            menciona_negocio: Number(judge.menciona_negocio ?? 0),
            tool_correcta: Number(judge.tool_correcta ?? 0),
            no_inventa: Number(judge.no_inventa ?? 0),
          }
        : null,
      judgeNotes: r.judge_notes ? String(r.judge_notes) : null,
      verdict: r.verdict as "pass" | "review" | "fail",
      adminDecision: r.admin_decision ? (String(r.admin_decision) as ValidatorMessageRow["adminDecision"]) : null,
      adminDecidedAt: toDate(r.admin_decided_at),
      adminDecidedBy: r.admin_decided_by ? String(r.admin_decided_by) : null,
      adminEditedResponse: r.admin_edited_response ? String(r.admin_edited_response) : null,
      tokensIn: r.tokens_in === null || r.tokens_in === undefined ? null : Number(r.tokens_in),
      tokensOut: r.tokens_out === null || r.tokens_out === undefined ? null : Number(r.tokens_out),
      durationMs: r.duration_ms === null || r.duration_ms === undefined ? null : Number(r.duration_ms),
      createdAt: toDate(r.created_at) ?? new Date(0),
    };
  });
}

// ─── getRunsKpi24h ───────────────────────────────────────────

export async function getRunsKpi24h(): Promise<{
  total: number;
  byStatus: Record<ValidatorRunStatus, number>;
}> {
  const result = await db.execute(sql`
    SELECT status, COUNT(*)::int AS n
    FROM validator_runs
    WHERE created_at >= now() - interval '24 hours'
    GROUP BY status
  `);

  const byStatus: Record<ValidatorRunStatus, number> = {
    running: 0,
    pass: 0,
    review: 0,
    fail: 0,
    error: 0,
  };
  let total = 0;
  for (const r of normalizeRows(result)) {
    const st = r.status as ValidatorRunStatus;
    const n = Number(r.n ?? 0);
    if (st in byStatus) {
      byStatus[st] = n;
      total += n;
    }
  }
  return { total, byStatus };
}
