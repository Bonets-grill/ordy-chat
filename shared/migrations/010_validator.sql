-- shared/migrations/010_validator.sql
-- 2026-04-18 · Sprint 2 validador-core
--
-- Tablas nuevas para el runner de semillas + judge LLM. Aditivo puro:
-- 0 cambios a tablas existentes. RLS defense-in-depth con helper
-- `current_tenant_id()` definido en migración 005.

BEGIN;

-- ── Runs del validador ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS validator_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    triggered_by TEXT NOT NULL
        CONSTRAINT validator_runs_triggered_by_check
        CHECK (triggered_by IN ('onboarding_auto', 'admin_manual', 'autopatch_retry')),
    nicho TEXT NOT NULL,  -- 'universal_only'|'restaurante'|'clinica'|'hotel'|'servicios'
    status TEXT NOT NULL
        CONSTRAINT validator_runs_status_check
        CHECK (status IN ('running', 'pass', 'review', 'fail', 'error')),
    summary_json JSONB,
    autopatch_attempts INTEGER NOT NULL DEFAULT 0,
    autopatch_applied_at TIMESTAMPTZ,
    previous_system_prompt TEXT,
    paused_by_this_run BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_validator_runs_tenant_recent
    ON validator_runs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_validator_runs_status_running
    ON validator_runs(status) WHERE status = 'running';

ALTER TABLE validator_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS validator_runs_tenant ON validator_runs;
CREATE POLICY validator_runs_tenant ON validator_runs
    FOR ALL
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

-- ── Mensajes individuales del run (1 por semilla) ──────────
CREATE TABLE IF NOT EXISTS validator_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES validator_runs(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    seed_id TEXT NOT NULL,                  -- "uni-01", "rest-03"
    seed_text TEXT NOT NULL,
    seed_expected_action TEXT,
    response_text TEXT NOT NULL,
    tools_called JSONB,
    asserts_result JSONB,
    judge_scores JSONB,
    judge_notes TEXT,
    verdict TEXT NOT NULL
        CONSTRAINT validator_messages_verdict_check
        CHECK (verdict IN ('pass', 'review', 'fail')),
    tokens_in INTEGER DEFAULT 0,
    tokens_out INTEGER DEFAULT 0,
    duration_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_validator_messages_run
    ON validator_messages(run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_validator_messages_tenant
    ON validator_messages(tenant_id, created_at DESC);

ALTER TABLE validator_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS validator_messages_tenant ON validator_messages;
CREATE POLICY validator_messages_tenant ON validator_messages
    FOR ALL
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

COMMIT;
