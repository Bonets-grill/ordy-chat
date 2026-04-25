-- Mig 051 — Biblioteca reusable de modificadores y alérgenos.
--
-- ANTES: cada producto tenía su propio modifier_group + modifiers (1:1 con menu_item).
--        Los alérgenos eran un text[] en menu_items.
--
-- DESPUÉS: el tenant define una biblioteca de grupos+opciones y de alérgenos UNA VEZ
--          y los asigna a N productos vía tablas link. Soporte i18n por entidad.
--          La dependencia condicional (Bonets: cocción solo si Medallon) vive en el
--          link por producto (no en la definición del grupo), porque el mismo grupo
--          puede asignarse a varios productos con dependencias distintas.
--
-- Esta migración es ADDITIVE — no toca tablas viejas. La 052 hace backfill.
-- La 053 hace cutover (drop columnas legacy) cuando todos los consumidores ya leen
-- del nuevo modelo.

BEGIN;

-- ── Biblioteca de grupos de modificadores (tenant-scoped) ────────────
CREATE TABLE IF NOT EXISTS modifier_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  selection_type text NOT NULL CHECK (selection_type IN ('single', 'multi')),
  required boolean NOT NULL DEFAULT false,
  min_select integer NOT NULL DEFAULT 0,
  -- NULL = sin límite (multi). Para single la app fuerza =1.
  max_select integer,
  sort_order integer NOT NULL DEFAULT 0,
  -- { en: { name }, fr: { name }, ... }
  i18n_translations jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_modifier_groups_tenant ON modifier_groups(tenant_id);

-- ── Opciones dentro de cada grupo ────────────────────────────────────
CREATE TABLE IF NOT EXISTS modifier_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
  name text NOT NULL,
  -- Solo positivos o cero. Descuentos no se modelan aquí.
  price_delta_cents integer NOT NULL DEFAULT 0 CHECK (price_delta_cents >= 0),
  available boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  i18n_translations jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_modifier_options_group ON modifier_options(group_id);

-- ── Link N:M producto ↔ grupo ────────────────────────────────────────
-- depends_on_option_id: si != NULL, el grupo solo aparece para este producto si
-- el cliente eligió esa opción concreta en otro grupo del mismo producto.
CREATE TABLE IF NOT EXISTS menu_item_modifier_group_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id uuid NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  depends_on_option_id uuid REFERENCES modifier_options(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (menu_item_id, group_id)
);

CREATE INDEX IF NOT EXISTS idx_mi_mod_links_item ON menu_item_modifier_group_links(menu_item_id);
CREATE INDEX IF NOT EXISTS idx_mi_mod_links_group ON menu_item_modifier_group_links(group_id);
CREATE INDEX IF NOT EXISTS idx_mi_mod_links_dep ON menu_item_modifier_group_links(depends_on_option_id)
  WHERE depends_on_option_id IS NOT NULL;

-- ── Biblioteca de alérgenos (tenant-scoped) ──────────────────────────
-- code: slug estable ("gluten", "lactosa", "frutos_secos") usado por la UI/brain.
-- label: nombre legible en idioma canónico (ES) — i18n_translations cubre el resto.
-- icon: emoji corto opcional para UI/WhatsApp ("🌾", "🥛").
CREATE TABLE IF NOT EXISTS allergens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code text NOT NULL,
  label text NOT NULL,
  icon text,
  sort_order integer NOT NULL DEFAULT 0,
  i18n_translations jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_allergens_tenant ON allergens(tenant_id);

-- ── Link N:M producto ↔ alérgeno ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS menu_item_allergens (
  menu_item_id uuid NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  allergen_id uuid NOT NULL REFERENCES allergens(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (menu_item_id, allergen_id)
);

CREATE INDEX IF NOT EXISTS idx_mi_allergens_allergen ON menu_item_allergens(allergen_id);

COMMIT;
