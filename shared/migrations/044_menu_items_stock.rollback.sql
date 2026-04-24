-- Rollback de mig 044 — control numérico de stock en menu_items.

ALTER TABLE menu_items DROP CONSTRAINT IF EXISTS menu_items_low_stock_threshold_nonneg;
ALTER TABLE menu_items DROP CONSTRAINT IF EXISTS menu_items_stock_qty_nonneg;

ALTER TABLE menu_items DROP COLUMN IF EXISTS last_low_stock_alert_at;
ALTER TABLE menu_items DROP COLUMN IF EXISTS low_stock_threshold;
ALTER TABLE menu_items DROP COLUMN IF EXISTS stock_qty;
