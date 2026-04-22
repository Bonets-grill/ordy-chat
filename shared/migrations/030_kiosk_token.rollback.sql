-- Rollback mig 030: elimina la columna kiosk_token de agent_configs.
-- ADVERTENCIA: esto invalida cualquier pantalla /kiosk/<token> activa.

DROP INDEX IF EXISTS agent_configs_kiosk_token_uniq;
ALTER TABLE agent_configs DROP COLUMN IF EXISTS kiosk_token;
