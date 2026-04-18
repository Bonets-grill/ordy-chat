-- shared/migrations/010_validator.rollback.sql
-- Deshace 010. Datos de validator_runs y validator_messages se pierden.
-- No afecta agent_configs/tenants (tablas no tocadas).

BEGIN;
DROP POLICY IF EXISTS validator_messages_tenant ON validator_messages;
DROP POLICY IF EXISTS validator_runs_tenant ON validator_runs;
DROP INDEX IF EXISTS idx_validator_messages_tenant;
DROP INDEX IF EXISTS idx_validator_messages_run;
DROP INDEX IF EXISTS idx_validator_runs_status_running;
DROP INDEX IF EXISTS idx_validator_runs_tenant_recent;
DROP TABLE IF EXISTS validator_messages;
DROP TABLE IF EXISTS validator_runs;
COMMIT;
