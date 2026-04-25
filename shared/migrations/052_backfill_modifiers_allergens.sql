-- Mig 052 — Backfill desde legacy a biblioteca. Idempotente.
--
-- Estrategia:
--   1. Cada (tenant_id, name) de menu_item_modifier_groups → 1 fila en modifier_groups.
--      Si dos productos tienen un grupo con el mismo nombre se DEDUPLICA en biblioteca
--      (es exactamente lo que queremos: una "Tamaño" por tenant, no 19).
--   2. Cada (group, modifier_name) de menu_item_modifiers → 1 fila en modifier_options.
--   3. Cada legacy row → 1 link (menu_item_id, group_id_biblioteca).
--   4. Para alérgenos: cada string distinto en menu_items.allergens text[] crea entrada
--      de biblioteca (code = label = el string original) y un link por uso.
--
-- Si los nombres de modifiers chocan entre productos pero los precios divergen, gana
-- el precio del primero insertado (DISTINCT ON). En la práctica los conjuntos coinciden
-- (mismo "Tamaño S 0€ / M +1€ / L +2€"). Mario revisará en /dashboard/modificadores
-- si hay algún choque y lo ajustará.

BEGIN;

-- 1. Grupos biblioteca (dedupe por tenant+nombre, conservar primer encuentro).
INSERT INTO modifier_groups (
  tenant_id, name, selection_type, required, min_select, max_select, sort_order, i18n_translations
)
SELECT DISTINCT ON (tenant_id, name)
  tenant_id, name, selection_type, required, min_select, max_select, sort_order, i18n_translations
FROM menu_item_modifier_groups
ORDER BY tenant_id, name, created_at ASC
ON CONFLICT (tenant_id, name) DO NOTHING;

-- 2. Opciones biblioteca. Dedupe por (group_biblioteca, name).
INSERT INTO modifier_options (
  group_id, name, price_delta_cents, available, sort_order, i18n_translations
)
SELECT DISTINCT ON (mg.id, m.name)
  mg.id, m.name, m.price_delta_cents, m.available, m.sort_order, m.i18n_translations
FROM menu_item_modifiers m
JOIN menu_item_modifier_groups lg ON lg.id = m.group_id
JOIN modifier_groups mg ON mg.tenant_id = lg.tenant_id AND mg.name = lg.name
WHERE NOT EXISTS (
  SELECT 1 FROM modifier_options mo WHERE mo.group_id = mg.id AND mo.name = m.name
)
ORDER BY mg.id, m.name, m.created_at ASC;

-- 3. Links producto ↔ grupo biblioteca.
INSERT INTO menu_item_modifier_group_links (menu_item_id, group_id, sort_order)
SELECT lg.menu_item_id, mg.id, lg.sort_order
FROM menu_item_modifier_groups lg
JOIN modifier_groups mg ON mg.tenant_id = lg.tenant_id AND mg.name = lg.name
ON CONFLICT (menu_item_id, group_id) DO NOTHING;

-- 4. Biblioteca de alérgenos a partir de menu_items.allergens text[].
INSERT INTO allergens (tenant_id, code, label)
SELECT DISTINCT mi.tenant_id, a, a
FROM menu_items mi
CROSS JOIN LATERAL unnest(mi.allergens) AS a
WHERE a IS NOT NULL AND a <> ''
ON CONFLICT (tenant_id, code) DO NOTHING;

-- 5. Links producto ↔ alérgeno.
INSERT INTO menu_item_allergens (menu_item_id, allergen_id)
SELECT mi.id, al.id
FROM menu_items mi
CROSS JOIN LATERAL unnest(mi.allergens) AS a
JOIN allergens al ON al.tenant_id = mi.tenant_id AND al.code = a
ON CONFLICT DO NOTHING;

COMMIT;
