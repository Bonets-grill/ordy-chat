-- 016_order_items_station.rollback.sql

DROP INDEX IF EXISTS idx_order_items_station;
ALTER TABLE order_items DROP COLUMN IF EXISTS station;
