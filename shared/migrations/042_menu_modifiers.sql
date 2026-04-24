-- Mig 042 — Modificadores de producto (extras, tamaños, sin-tal).
--
-- Cada item de la carta puede tener N grupos de modificadores. Un grupo es:
--   - "Tamaño"  (single, required, min=1, max=1)         → radio
--   - "Extras"  (multi,  optional, min=0, max=NULL)      → checkbox
--   - "Sin"     (multi,  optional, min=0, max=NULL)      → quitar ingredientes
--
-- Cada grupo contiene N modifiers concretos:
--   "Extra queso"  +1.50€
--   "Sin cebolla"   0.00€
--   "Tamaño grande" +3.00€
--
-- price_delta_cents es SIEMPRE >= 0. Negativos no permitidos (un descuento se
-- modela como precio base más alto + modifier "tamaño pequeño" a 0). Esto
-- impide que el cliente abuse seleccionando modifiers para bajar el total.
--
-- Cuando se crea un order_item, los modifiers seleccionados se persisten en
-- order_items.modifiers_json (jsonb). NO joinamos contra menu_item_modifiers
-- en cada query del KDS — y así sobrevive la línea aunque luego se borre el
-- modifier o el item entero. unit_price_cents YA incorpora la suma de deltas.

-- ── Grupos de modificadores ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS menu_item_modifier_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    menu_item_id UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    selection_type TEXT NOT NULL
        CHECK (selection_type IN ('single', 'multi')),
    required BOOLEAN NOT NULL DEFAULT false,
    min_select INTEGER NOT NULL DEFAULT 0
        CHECK (min_select >= 0),
    max_select INTEGER
        CHECK (max_select IS NULL OR max_select >= 1),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Coherencia min<=max cuando ambos están definidos.
    CONSTRAINT chk_min_le_max CHECK (max_select IS NULL OR min_select <= max_select),
    -- Single = exactamente 1 selección. Forzamos max=1 para que el UI no se
    -- pueda confundir. min puede ser 0 (opcional) o 1 (required).
    CONSTRAINT chk_single_max_one CHECK (selection_type <> 'single' OR max_select = 1)
);

CREATE INDEX IF NOT EXISTS idx_modifier_groups_item
    ON menu_item_modifier_groups(menu_item_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_modifier_groups_tenant
    ON menu_item_modifier_groups(tenant_id);

-- ── Modificadores concretos dentro de cada grupo ────────────────────
CREATE TABLE IF NOT EXISTS menu_item_modifiers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES menu_item_modifier_groups(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    -- Delta de precio en céntimos. Solo positivos o cero. Un "extra" suma
    -- al base; un "sin cebolla" es 0. Descuentos no se modelan aquí.
    price_delta_cents INTEGER NOT NULL DEFAULT 0
        CHECK (price_delta_cents >= 0),
    available BOOLEAN NOT NULL DEFAULT true,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_modifiers_group
    ON menu_item_modifiers(group_id, sort_order);

-- ── order_items: snapshot de modifiers seleccionados ───────────────
-- jsonb con la forma:
--   [
--     { "groupId": "uuid", "modifierId": "uuid", "name": "Extra queso", "priceDeltaCents": 150 },
--     ...
--   ]
-- Si el modifier se borra después, el snapshot sigue mostrando la línea
-- correcta en el KDS y en el recibo.
ALTER TABLE order_items
    ADD COLUMN IF NOT EXISTS modifiers_json JSONB NOT NULL DEFAULT '[]'::jsonb;
