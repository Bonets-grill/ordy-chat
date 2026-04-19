-- 014_tenant_timezone.sql
-- Columna explícita tenants.timezone (IANA). Reemplaza el parche por keyword
-- de billing_city en runtime/app/tenants.py. Default Europe/Madrid; backfill
-- Atlantic/Canary para tenants con billing_city en provincias canarias.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Europe/Madrid';

-- Backfill Canarias por keyword de billing_city (Santa Cruz de Tenerife o
-- Las Palmas cubren los 7 islas). Idempotente — solo toca filas cuyo tz
-- sigue en el default.
UPDATE tenants
SET timezone = 'Atlantic/Canary'
WHERE timezone = 'Europe/Madrid'
  AND (
    lower(coalesce(billing_city, '')) ~ '(tenerife|palmas|lanzarote|fuerteventura|gomera|hierro)'
  );

COMMENT ON COLUMN tenants.timezone IS
  'IANA tz. Europe/Madrid default, Atlantic/Canary para Canarias. Usado por runtime/app/tenants.py para inyectar <ahora> al bot con hora local correcta.';
