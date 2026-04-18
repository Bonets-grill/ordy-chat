-- shared/migrations/011_validator_ui.rollback.sql
-- Deshace 011. Datos de admin_decision en validator_messages se pierden.
-- validation_mode override por tenant se pierde (vuelve a usar flag global).

BEGIN;
ALTER TABLE validator_messages
    DROP COLUMN IF EXISTS admin_edited_response,
    DROP COLUMN IF EXISTS admin_decided_by,
    DROP COLUMN IF EXISTS admin_decided_at,
    DROP COLUMN IF EXISTS admin_decision;
ALTER TABLE agent_configs DROP COLUMN IF EXISTS validation_mode;
COMMIT;
