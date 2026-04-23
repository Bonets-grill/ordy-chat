-- Rollback migración 034: quita la columna image_url de menu_items.

ALTER TABLE menu_items
  DROP COLUMN IF EXISTS image_url;
