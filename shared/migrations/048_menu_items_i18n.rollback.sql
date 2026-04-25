-- Rollback Mig 048
ALTER TABLE menu_items DROP COLUMN IF EXISTS i18n_translations;
ALTER TABLE menu_item_modifier_groups DROP COLUMN IF EXISTS i18n_translations;
ALTER TABLE menu_item_modifiers DROP COLUMN IF EXISTS i18n_translations;
