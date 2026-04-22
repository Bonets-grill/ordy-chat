-- shared/migrations/028_menu_items.rollback.sql

ALTER TABLE agent_configs DROP COLUMN IF EXISTS menu_pending;

DROP INDEX IF EXISTS menu_items_tenant_available_idx;
DROP INDEX IF EXISTS menu_items_tenant_name_lower_idx;
DROP INDEX IF EXISTS menu_items_tenant_category_idx;

DROP TABLE IF EXISTS menu_items;
