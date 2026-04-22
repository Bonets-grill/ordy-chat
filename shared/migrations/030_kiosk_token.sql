-- shared/migrations/030_kiosk_token.sql
-- Token público por tenant para montar el KDS en pantallas siempre activas
-- (tablets/TVs de cocina) sin que el staff tenga que hacer login.
--
-- La URL pública `/kiosk/<token>` no pasa por Auth.js:
--   - Lee el token de la URL, busca el tenant en agent_configs.kiosk_token.
--   - Si válido y no revocado, renderiza el KDS board.
--   - Los fetches del board (orders + reservas + aceptar/rechazar) mandan
--     `x-kiosk-token: <token>` como alternativa al cookie de Auth.js.
--
-- Scope: SOLO lectura del KDS + aceptar/rechazar pedidos. NO permite:
--   - Cambiar agent config.
--   - Ver conversaciones o reservas fuera del KDS.
--   - Modificar menú, reglas, etc.
--
-- Rotación: el super admin puede ejecutar `UPDATE agent_configs
-- SET kiosk_token = gen_random_uuid()::text WHERE tenant_id = '...'` para
-- invalidar el token anterior (cualquier tablet con la URL vieja deja de
-- funcionar). Versión inicial sin UI — se rota por DB directa.
--
-- Idempotente.

ALTER TABLE agent_configs
  ADD COLUMN IF NOT EXISTS kiosk_token TEXT;

-- DEFAULT a gen_random_uuid()::text: nuevos tenants reciben su token solos,
-- los callers (onboarding-fast, Drizzle) no necesitan pasar el campo.
ALTER TABLE agent_configs
  ALTER COLUMN kiosk_token SET DEFAULT gen_random_uuid()::text;

-- Backfill: genera un token por tenant que no tenga. gen_random_uuid() viene
-- del módulo pgcrypto que ya estamos usando en otras tablas (id default).
UPDATE agent_configs
   SET kiosk_token = gen_random_uuid()::text
 WHERE kiosk_token IS NULL;

ALTER TABLE agent_configs
  ALTER COLUMN kiosk_token SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS agent_configs_kiosk_token_uniq
  ON agent_configs (kiosk_token);

COMMENT ON COLUMN agent_configs.kiosk_token IS 'Token UUID público para /kiosk/<token>. Rotar vía UPDATE para invalidar pantallas existentes.';
