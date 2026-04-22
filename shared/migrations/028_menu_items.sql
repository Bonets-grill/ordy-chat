-- shared/migrations/028_menu_items.sql
-- Source-of-truth ESTRUCTURADO para la carta de cada tenant. Hasta hoy la carta
-- vivía como texto libre dentro de agent_configs.system_prompt (escrito a mano
-- en onboarding o pegado como bloque). Eso causaba 2 problemas:
--   1. Onboarding-fast no podía actualizar la carta sin reescribir todo el prompt.
--   2. El bot no podía hacer fuzzy match sobre items reales — dependía de que
--      Claude reconociera Dakota↔Dacoka literal del prompt.
--
-- Ahora la carta vive en `menu_items` con campos estructurados. El brain.py
-- inyectará un bloque <carta> dinámico en cada turno (similar a menu_overrides)
-- y una tool `consultar_carta(query)` permitirá búsqueda server-side.
--
-- Idempotente: CREATE TABLE IF NOT EXISTS + IF NOT EXISTS para indices.

CREATE TABLE IF NOT EXISTS menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT 'Otros',
  name TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  description TEXT,
  allergens TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  -- Disponibilidad permanente (false = ítem no en carta hoy. Para "agotado HOY"
  -- usar menu_overrides que ya existe — diferencia: menu_items.available=false
  -- es persistente, menu_overrides es time-bounded).
  available BOOLEAN NOT NULL DEFAULT true,
  -- Orden de aparición en la carta dentro de su categoría (asc).
  sort_order INTEGER NOT NULL DEFAULT 0,
  -- Origen: 'manual' (admin lo creó) | 'scrape' (extraído de URL/PDF en onboarding).
  -- Útil para distinguir items que el dueño revisó de los autocargados.
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'scrape', 'pdf', 'import')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index para listar carta por tenant rápido (la query principal en brain).
CREATE INDEX IF NOT EXISTS menu_items_tenant_category_idx
  ON menu_items (tenant_id, category, sort_order);

-- Index lower(name) para fuzzy match server-side (consultar_carta tool).
-- Permite ILIKE rápido + future similarity() si activamos pg_trgm.
CREATE INDEX IF NOT EXISTS menu_items_tenant_name_lower_idx
  ON menu_items (tenant_id, LOWER(name));

-- Solo items disponibles, para inyección en system block (skip los inactivos).
CREATE INDEX IF NOT EXISTS menu_items_tenant_available_idx
  ON menu_items (tenant_id, sort_order)
  WHERE available = true;

-- Flag en agent_configs para detectar tenants que terminaron onboarding sin
-- carta cargada. La UI del dashboard mostrará un CTA "Sube tu carta" arriba
-- mientras menu_pending=true, y se baja a false en cuanto tenga >= 1 item.
ALTER TABLE agent_configs
  ADD COLUMN IF NOT EXISTS menu_pending BOOLEAN NOT NULL DEFAULT true;

COMMENT ON TABLE menu_items IS 'Carta estructurada del tenant. Inyectada como bloque <carta> en system block del brain. Source manual|scrape|pdf|import.';
COMMENT ON COLUMN menu_items.available IS 'Disponibilidad PERSISTENTE. Para agotado del día usar menu_overrides (time-bounded).';
COMMENT ON COLUMN menu_items.sort_order IS 'Orden ASC dentro de su category. Drag-drop en UI lo actualiza.';
COMMENT ON COLUMN agent_configs.menu_pending IS 'true mientras tenant no tenga ningún menu_item. UI muestra CTA "Sube tu carta".';
