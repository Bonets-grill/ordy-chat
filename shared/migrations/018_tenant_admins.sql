-- 018_tenant_admins.sql — WhatsApp admin mode (números autorizados del tenant).
--
-- Objetivo: permitir que el dueño del restaurante y su staff manejen cambios
-- operativos (stock, horarios, reservas) escribiendo al MISMO número de
-- WhatsApp que usan sus clientes. El runtime distingue cliente vs admin
-- buscando el `from` del mensaje en esta tabla.
--
-- Seguridad por capas:
--   1. phone_wa + tenant_id es UNIQUE → un número solo es admin de un tenant
--      por (tenant_id, phone_wa).
--   2. pin_hash obligatorio al crear; primera vez que el número escribe pide
--      PIN y marca last_auth_at. Sesión expira en 7 días (validación en
--      runtime).
--   3. auth_attempts cuenta intentos fallidos → runtime bloquea tras N
--      intentos (lógica en runtime, no en DB).

CREATE TABLE IF NOT EXISTS tenant_admins (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone_wa       TEXT NOT NULL,           -- E.164, ej. "+34604342381"
  display_name   TEXT,                    -- "Jefe 1", "Juan socio" (opcional)
  pin_hash       TEXT NOT NULL,           -- bcrypt del PIN generado al crear
  last_auth_at   TIMESTAMPTZ,             -- última verificación PIN OK
  auth_attempts  INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (tenant_id, phone_wa)
);

-- Lookup rápido desde el runtime: "¿el from de este WhatsApp es admin?"
-- Usa ambas columnas porque el runtime resuelve tenant_id antes (por
-- phone_number_id del webhook) y luego verifica phone_wa del mensaje.
CREATE INDEX IF NOT EXISTS idx_tenant_admins_tenant_phone
  ON tenant_admins (tenant_id, phone_wa);

COMMENT ON TABLE tenant_admins IS
  'Números WhatsApp autorizados para modo admin del tenant. ' ||
  'El runtime (brain.py admin_resolver) mira aquí para decidir prompt+tools.';
COMMENT ON COLUMN tenant_admins.pin_hash IS
  'bcrypt del PIN 4-dígitos. Generado UNA vez al crear admin desde dashboard. ' ||
  'Regenerable (reemplaza hash) pero nunca legible después.';
COMMENT ON COLUMN tenant_admins.last_auth_at IS
  'Sesión admin válida si last_auth_at > now()-7days. Si NULL → nunca verificó.';
