// web/tests/unit/admin/validator-queries.test.ts — tests del módulo F2.
//
// Mockeamos @/lib/db.execute() para verificar shape del output y
// normalización (Date, summary, neon-http alt shape).

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => {
  return {
    db: {
      execute: vi.fn(),
    },
  };
});

import { db } from "@/lib/db";
import {
  getMessagesOfRun,
  getRunDetail,
  getRuns,
  getRunsKpi24h,
} from "@/lib/admin/validator-queries";

const mockDb = db as unknown as { execute: ReturnType<typeof vi.fn> };

beforeEach(() => {
  mockDb.execute.mockClear();
});

// ─── getRuns ──────────────────────────────────────────────────

describe("getRuns", () => {
  const baseRow = {
    id: "00000000-0000-0000-0000-0000000000aa",
    tenant_id: "00000000-0000-0000-0000-0000000000bb",
    tenant_slug: "taberna-lope",
    tenant_name: "La Taberna de Lope",
    triggered_by: "onboarding_auto",
    nicho: "restaurante",
    status: "pass",
    summary_json: { total: 8, passed: 7, review: 1, failed: 0 },
    autopatch_attempts: 0,
    autopatch_applied_at: null,
    paused_by_this_run: false,
    created_at: "2026-04-18T16:00:00Z",
    completed_at: "2026-04-18T16:02:00Z",
  };

  it("transforma raw rows → ValidatorRunListItem[]", async () => {
    mockDb.execute.mockResolvedValue([baseRow]);
    const rows = await getRuns();
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.tenantSlug).toBe("taberna-lope");
    expect(r.status).toBe("pass");
    expect(r.summary).toEqual({ total: 8, passed: 7, review: 1, failed: 0 });
    expect(r.createdAt).toBeInstanceOf(Date);
    expect(r.completedAt).toBeInstanceOf(Date);
  });

  it("soporta shape {rows:[...]} (neon-http)", async () => {
    mockDb.execute.mockResolvedValue({ rows: [baseRow] });
    const rows = await getRuns();
    expect(rows).toHaveLength(1);
  });

  it("summary=null cuando summary_json es null o malformado", async () => {
    mockDb.execute.mockResolvedValue([
      { ...baseRow, summary_json: null },
      { ...baseRow, id: "x", summary_json: "string raro" },
    ]);
    const rows = await getRuns();
    expect(rows[0]!.summary).toBeNull();
    expect(rows[1]!.summary).toBeNull();
  });

  it("completedAt=null cuando aún corre", async () => {
    mockDb.execute.mockResolvedValue([
      { ...baseRow, status: "running", completed_at: null },
    ]);
    const rows = await getRuns();
    expect(rows[0]!.completedAt).toBeNull();
    expect(rows[0]!.status).toBe("running");
  });

  it("limit se acota a [1,200] y offset a [0,∞)", async () => {
    mockDb.execute.mockResolvedValue([]);
    await getRuns({ limit: 9999, offset: -5 });
    // No se lanza; solo validamos que la query se ejecutó.
    expect(mockDb.execute).toHaveBeenCalledOnce();
  });
});

// ─── getRunDetail ─────────────────────────────────────────────

describe("getRunDetail", () => {
  it("devuelve null si no encuentra run", async () => {
    mockDb.execute.mockResolvedValue([]);
    const detail = await getRunDetail("00000000-0000-0000-0000-0000000000dd");
    expect(detail).toBeNull();
  });

  it("incluye previousSystemPrompt si presente", async () => {
    mockDb.execute.mockResolvedValue([
      {
        id: "r1",
        tenant_id: "t1",
        tenant_slug: "x",
        tenant_name: "X",
        triggered_by: "autopatch_retry",
        nicho: "servicios",
        status: "pass",
        summary_json: null,
        autopatch_attempts: 1,
        autopatch_applied_at: "2026-04-18T12:00:00Z",
        paused_by_this_run: true,
        previous_system_prompt: "Eres Ordy, asistente…",
        created_at: "2026-04-18T11:00:00Z",
        completed_at: "2026-04-18T11:05:00Z",
      },
    ]);
    const detail = await getRunDetail("r1");
    expect(detail?.previousSystemPrompt).toContain("Ordy");
    expect(detail?.autopatchAttempts).toBe(1);
    expect(detail?.autopatchAppliedAt).toBeInstanceOf(Date);
  });
});

// ─── getMessagesOfRun ─────────────────────────────────────────

describe("getMessagesOfRun", () => {
  it("mapea asserts y judge scores; null-safe en admin_*", async () => {
    mockDb.execute.mockResolvedValue([
      {
        id: "m1",
        seed_id: "rest-01",
        seed_text: "¿abren hoy?",
        seed_expected_action: null,
        response_text: "Sí, hasta las 23:00.",
        tools_called: null,
        asserts_result: { idioma_ok: true, no_filtra_prompt: true, no_falsa_promesa_pago: true },
        judge_scores: { tono: 10, menciona_negocio: 9, tool_correcta: 10, no_inventa: 10 },
        judge_notes: null,
        verdict: "pass",
        admin_decision: null,
        admin_decided_at: null,
        admin_decided_by: null,
        admin_edited_response: null,
        tokens_in: 120,
        tokens_out: 40,
        duration_ms: 880,
        created_at: "2026-04-18T16:01:00Z",
      },
    ]);
    const msgs = await getMessagesOfRun("r1");
    expect(msgs).toHaveLength(1);
    const m = msgs[0]!;
    expect(m.assertsResult?.idioma_ok).toBe(true);
    expect(m.judgeScores?.tono).toBe(10);
    expect(m.verdict).toBe("pass");
    expect(m.adminDecision).toBeNull();
  });

  it("marca adminDecision='edited' + admin_edited_response presente", async () => {
    mockDb.execute.mockResolvedValue([
      {
        id: "m2",
        seed_id: "rest-02",
        seed_text: "dame el menú",
        seed_expected_action: null,
        response_text: "Original raw",
        tools_called: null,
        asserts_result: null,
        judge_scores: null,
        judge_notes: null,
        verdict: "review",
        admin_decision: "edited",
        admin_decided_at: "2026-04-18T16:10:00Z",
        admin_decided_by: "00000000-0000-0000-0000-000000000042",
        admin_edited_response: "Respuesta corregida por admin",
        tokens_in: null,
        tokens_out: null,
        duration_ms: null,
        created_at: "2026-04-18T16:01:00Z",
      },
    ]);
    const msgs = await getMessagesOfRun("r2");
    const m = msgs[0]!;
    expect(m.adminDecision).toBe("edited");
    expect(m.adminEditedResponse).toBe("Respuesta corregida por admin");
    expect(m.adminDecidedAt).toBeInstanceOf(Date);
    expect(m.tokensIn).toBeNull();
  });
});

// ─── getRunsKpi24h ────────────────────────────────────────────

describe("getRunsKpi24h", () => {
  it("cuenta 0 por status cuando no hay rows", async () => {
    mockDb.execute.mockResolvedValue([]);
    const kpi = await getRunsKpi24h();
    expect(kpi.total).toBe(0);
    expect(kpi.byStatus).toEqual({ running: 0, pass: 0, review: 0, fail: 0, error: 0 });
  });

  it("suma total y agrega por status", async () => {
    mockDb.execute.mockResolvedValue([
      { status: "pass", n: 4 },
      { status: "review", n: 1 },
      { status: "fail", n: 2 },
      { status: "running", n: 1 },
    ]);
    const kpi = await getRunsKpi24h();
    expect(kpi.total).toBe(8);
    expect(kpi.byStatus.pass).toBe(4);
    expect(kpi.byStatus.fail).toBe(2);
    expect(kpi.byStatus.error).toBe(0);
  });

  it("ignora status desconocidos (robusto a schema drift)", async () => {
    mockDb.execute.mockResolvedValue([
      { status: "pass", n: 1 },
      { status: "weird", n: 99 },
    ]);
    const kpi = await getRunsKpi24h();
    expect(kpi.total).toBe(1); // weird excluido
    expect(Object.keys(kpi.byStatus)).toHaveLength(5);
  });
});
