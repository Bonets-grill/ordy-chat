-- Mig 053 — Cutover. Dropea las tablas legacy y la columna allergens text[].
--
-- Solo seguro si:
--   1. Mig 052 corrió OK y los datos están en la biblioteca.
--   2. Todos los consumidores (web + runtime) ya leen del nuevo modelo.
--
-- Verificación pre-cutover:
--   SELECT
--     (SELECT COUNT(*) FROM menu_item_modifier_groups) AS legacy_groups,
--     (SELECT COUNT(*) FROM modifier_groups)            AS new_groups,
--     (SELECT COUNT(*) FROM menu_item_modifier_group_links) AS new_links;
--   -- legacy_groups <= new_links debe cumplirse.

BEGIN;

DROP TABLE IF EXISTS menu_item_modifiers CASCADE;
DROP TABLE IF EXISTS menu_item_modifier_groups CASCADE;
ALTER TABLE menu_items DROP COLUMN IF EXISTS allergens;

COMMIT;
