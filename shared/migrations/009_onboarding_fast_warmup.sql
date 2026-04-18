-- shared/migrations/009_onboarding_fast_warmup.sql
-- 2026-04-18 · Onboarding Fast + warm-up anti-ban
--
-- Contiene:
--   1. Tabla onboarding_jobs (jobs de scraping + merger en curso).
--   2. Columnas nuevas en provider_credentials para warm-up y burn tracking.
--
-- IMPORTANTE warm-up retroactivo: si ponemos DEFAULT now() al nuevo
-- `instance_created_at` sobre filas existentes, todas las instancias ya maduras
-- pasarían a estar en "día 1" del warm-up (cap 30 msgs/día). Para evitarlo:
--   a) Añadir la columna NULLABLE primero.
--   b) Backfill con fecha pasada (30 días atrás = madura).
--   c) Marcar NOT NULL + DEFAULT now() para filas nuevas.

BEGIN;

-- ── Onboarding jobs ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS onboarding_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    urls_json JSONB NOT NULL,
    status TEXT NOT NULL
        CONSTRAINT onboarding_jobs_status_check
        CHECK (status IN ('pending','scraping','sources_ready','ready','confirming','done','failed')),
    result_json JSONB,
    error TEXT,
    -- Consent legal: sin esto Google/TripAdvisor TOS hace el scraping indefendible.
    consent_accepted_at TIMESTAMPTZ,
    consent_ip INET,
    -- Watchdog: si scrape_deadline_at < now() y status aún activo → marcar failed.
    scrape_started_at TIMESTAMPTZ,
    scrape_deadline_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_jobs_user_recent
    ON onboarding_jobs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_onboarding_jobs_status_pending
    ON onboarding_jobs(status)
    WHERE status IN ('pending','scraping','sources_ready');
CREATE INDEX IF NOT EXISTS idx_onboarding_jobs_result_purge
    ON onboarding_jobs(created_at)
    WHERE result_json IS NOT NULL;

-- RLS defense-in-depth. La app ya filtra por user_id, esta policy es red extra.
-- La app debe hacer SET app.current_user_id = '<uuid>' al inicio del request.
ALTER TABLE onboarding_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS onboarding_jobs_owner ON onboarding_jobs;
CREATE POLICY onboarding_jobs_owner ON onboarding_jobs
    FOR ALL
    USING (
        user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
    WITH CHECK (
        user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    );

-- ── Warm-up anti-ban columnas ────────────────────────────────
ALTER TABLE provider_credentials
    ADD COLUMN IF NOT EXISTS instance_created_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS burned BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS burned_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS burned_reason TEXT;

-- Backfill: instancias preexistentes = maduras (cap diario no aplica).
UPDATE provider_credentials
SET instance_created_at = now() - interval '30 days'
WHERE instance_created_at IS NULL;

-- Ahora sí: NOT NULL + default para filas nuevas.
ALTER TABLE provider_credentials
    ALTER COLUMN instance_created_at SET NOT NULL,
    ALTER COLUMN instance_created_at SET DEFAULT now();

COMMIT;
