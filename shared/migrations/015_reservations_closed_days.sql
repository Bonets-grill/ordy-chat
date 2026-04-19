-- 015_reservations_closed_days.sql
-- Fechas concretas en las que el agente NO acepta reservas nuevas (restaurante
-- lleno, vacaciones, evento privado, etc.). Se inyecta en el system_prompt
-- del runtime y la tool crear_cita hace double-guard contra la misma columna.
-- Housekeeping diario (cron 04:00 Madrid) purga fechas pasadas.

ALTER TABLE agent_configs
  ADD COLUMN IF NOT EXISTS reservations_closed_for DATE[] NOT NULL DEFAULT ARRAY[]::DATE[];

CREATE INDEX IF NOT EXISTS idx_agent_configs_closed_for_gin
  ON agent_configs USING GIN (reservations_closed_for);

COMMENT ON COLUMN agent_configs.reservations_closed_for IS
  'Fechas (DATE) en que el tenant no acepta reservas nuevas. Inyectado en system_prompt por runtime/app/brain.py. Guard en runtime/app/agent_tools.py:crear_cita rechaza fechas aquí listadas. Cron web/app/api/cron/closed-days-cleanup/route.ts purga fechas < CURRENT_DATE diariamente.';
