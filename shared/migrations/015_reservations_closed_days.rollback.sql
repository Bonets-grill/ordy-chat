-- 015_reservations_closed_days.rollback.sql

DROP INDEX IF EXISTS idx_agent_configs_closed_for_gin;
ALTER TABLE agent_configs DROP COLUMN IF EXISTS reservations_closed_for;
