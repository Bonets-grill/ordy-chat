-- Rollback Mig 051. Solo si NO se ha aplicado 052/053 (datos referenciados se perderían).
BEGIN;
DROP TABLE IF EXISTS menu_item_allergens;
DROP TABLE IF EXISTS allergens;
DROP TABLE IF EXISTS menu_item_modifier_group_links;
DROP TABLE IF EXISTS modifier_options;
DROP TABLE IF EXISTS modifier_groups;
COMMIT;
