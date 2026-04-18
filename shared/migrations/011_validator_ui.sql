-- shared/migrations/011_validator_ui.sql
-- 2026-04-18 · Sprint 3 validador-ui
--
-- Aditivo puro. Añade:
--   - agent_configs.validation_mode (NULL = usa flag global)
--   - validator_messages.admin_decision + admin_decided_at + admin_decided_by + admin_edited_response

BEGIN;

ALTER TABLE agent_configs
    ADD COLUMN IF NOT EXISTS validation_mode TEXT
        CONSTRAINT agent_configs_validation_mode_check
        CHECK (validation_mode IS NULL OR validation_mode IN ('auto', 'manual', 'skip'));

ALTER TABLE validator_messages
    ADD COLUMN IF NOT EXISTS admin_decision TEXT
        CONSTRAINT validator_messages_admin_decision_check
        CHECK (admin_decision IS NULL OR admin_decision IN ('approved', 'rejected', 'edited')),
    ADD COLUMN IF NOT EXISTS admin_decided_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS admin_decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS admin_edited_response TEXT;

COMMIT;
