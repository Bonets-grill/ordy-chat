-- Rollback Mig 052 — vacía las tablas biblioteca y links creadas a partir del backfill.
-- Solo seguro si NO se ha aplicado 053 (que dropa las columnas legacy origen).
BEGIN;
TRUNCATE TABLE menu_item_allergens, menu_item_modifier_group_links, modifier_options, allergens, modifier_groups CASCADE;
COMMIT;
