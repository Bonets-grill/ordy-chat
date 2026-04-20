-- 019_menu_overrides.sql — Overrides temporales sobre el catálogo de menú.
--
-- Contexto: el catálogo base del menú vive en agent_configs.knowledge (JSONB)
-- como lo produjo el onboarding. Cambios frecuentes del día-a-día (sin stock,
-- cambio de precio puntual, nota especial) NO deben reescribir el catálogo
-- base — lo harían frágil y sin posibilidad de rollback.
--
-- Esta tabla guarda overrides por item con caducidad automática:
--   available=false + active_until=mañana 00:00 → "sin pulpo hoy"
-- El runtime (brain cliente + herramientas admin) consulta ambos: catálogo
-- base ∪ overrides activos, y presenta la fusión al cliente.
--
-- Diseño:
--   - UNIQUE(tenant_id, item_name): un item solo tiene un override activo a
--     la vez. Si el admin dice "sin pulpo" dos veces, el 2º ON CONFLICT
--     actualiza (refresca active_until).
--   - active_until NULL = permanente (raro, usualmente hasta mañana).
--   - Índice parcial WHERE active_until > NOW() es eficiente porque la
--     mayoría de overrides son temporales y el runtime los consulta frecuente.
--   - item_name se matchea case-insensitive en el runtime (lower() en query).

CREATE TABLE IF NOT EXISTS menu_overrides (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_name              TEXT NOT NULL,
  available              BOOLEAN NOT NULL DEFAULT false,
  price_override_cents   INTEGER,
  note                   TEXT,
  active_until           TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_admin_id    UUID REFERENCES tenant_admins(id) ON DELETE SET NULL,
  UNIQUE (tenant_id, item_name)
);

-- Índice compuesto: no se usa WHERE con NOW() porque NOW() no es IMMUTABLE
-- y Postgres rechaza funciones volátiles en índice parcial. Las queries
-- típicas "tenant_id = X AND (active_until IS NULL OR active_until > now())"
-- aprovechan el índice por tenant_id + ordenación por active_until.
CREATE INDEX IF NOT EXISTS idx_menu_overrides_tenant_active_until
  ON menu_overrides (tenant_id, active_until);

COMMENT ON TABLE menu_overrides IS
  'Overrides temporales por item del catálogo. Capa sobre agent_configs.knowledge. ' ||
  'Admin WhatsApp los crea con "sin pulpo", se aplican al menú cliente hasta active_until.';
COMMENT ON COLUMN menu_overrides.available IS
  'false = sin stock (cliente recibe "lo siento, hoy no hay"). ' ||
  'true = re-habilitado explícitamente (útil si base knowledge lo marca como stop pero hoy sí hay).';
COMMENT ON COLUMN menu_overrides.price_override_cents IS
  'Precio puntual para hoy (ej. "sube el solomillo a 22€"). NULL = usar precio base del catálogo.';
COMMENT ON COLUMN menu_overrides.active_until IS
  'Caducidad. NULL = permanente (raro). Default en INSERT runtime: mañana 00:00 en TZ del tenant.';
