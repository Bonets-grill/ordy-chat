-- Rollback Mig 053. NO restaura datos perdidos por el DROP — solo recrea las
-- tablas vacías para que código viejo no truene si se hizo deploy a medias.
-- Los datos viven en la biblioteca; este rollback es un "patch" de emergencia.
BEGIN;

CREATE TABLE IF NOT EXISTS menu_item_modifier_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  menu_item_id uuid NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  name text NOT NULL,
  selection_type text NOT NULL,
  required boolean NOT NULL DEFAULT false,
  min_select integer NOT NULL DEFAULT 0,
  max_select integer,
  sort_order integer NOT NULL DEFAULT 0,
  i18n_translations jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS menu_item_modifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES menu_item_modifier_groups(id) ON DELETE CASCADE,
  name text NOT NULL,
  price_delta_cents integer NOT NULL DEFAULT 0,
  available boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  i18n_translations jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS allergens text[] NOT NULL DEFAULT ARRAY[]::text[];

COMMIT;
