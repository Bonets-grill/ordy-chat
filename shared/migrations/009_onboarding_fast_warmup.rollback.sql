-- shared/migrations/009_onboarding_fast_warmup.rollback.sql
-- Deshace la migración 009.
-- NOTA: los datos de onboarding_jobs se pierden. Las columnas de warm-up
-- en provider_credentials también — no afecta el bot (son solo para cap diario).

BEGIN;

DROP POLICY IF EXISTS onboarding_jobs_owner ON onboarding_jobs;
DROP INDEX IF EXISTS idx_onboarding_jobs_result_purge;
DROP INDEX IF EXISTS idx_onboarding_jobs_status_pending;
DROP INDEX IF EXISTS idx_onboarding_jobs_user_recent;
DROP TABLE IF EXISTS onboarding_jobs;

ALTER TABLE provider_credentials
    DROP COLUMN IF EXISTS burned_reason,
    DROP COLUMN IF EXISTS burned_at,
    DROP COLUMN IF EXISTS burned,
    DROP COLUMN IF EXISTS instance_created_at;

COMMIT;
