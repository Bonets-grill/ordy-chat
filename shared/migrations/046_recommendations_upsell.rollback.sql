-- Rollback mig 046.
ALTER TABLE agent_configs DROP CONSTRAINT IF EXISTS chk_upsell_config_object;
ALTER TABLE agent_configs DROP COLUMN IF EXISTS upsell_config;
DROP INDEX IF EXISTS idx_menu_items_tenant_recommended;
ALTER TABLE menu_items DROP COLUMN IF EXISTS is_recommended;
