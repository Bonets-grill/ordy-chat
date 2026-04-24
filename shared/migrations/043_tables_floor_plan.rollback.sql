-- Rollback de mig 043: quita campos del plano de mesas.
-- Idempotente. NO toca number/zone/seats/active/sort_order (eran pre-043).

ALTER TABLE restaurant_tables
  DROP CONSTRAINT IF EXISTS restaurant_tables_shape_chk,
  DROP CONSTRAINT IF EXISTS restaurant_tables_seats_chk,
  DROP CONSTRAINT IF EXISTS restaurant_tables_rotation_chk,
  DROP CONSTRAINT IF EXISTS restaurant_tables_width_chk,
  DROP CONSTRAINT IF EXISTS restaurant_tables_height_chk;

ALTER TABLE restaurant_tables
  DROP COLUMN IF EXISTS pos_x,
  DROP COLUMN IF EXISTS pos_y,
  DROP COLUMN IF EXISTS shape,
  DROP COLUMN IF EXISTS rotation,
  DROP COLUMN IF EXISTS area,
  DROP COLUMN IF EXISTS width,
  DROP COLUMN IF EXISTS height;
