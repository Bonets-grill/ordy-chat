-- Rollback mig 038
DROP INDEX IF EXISTS orders_shift_id_idx;
ALTER TABLE orders DROP COLUMN IF EXISTS shift_id;
DROP INDEX IF EXISTS shifts_tenant_opened_at_idx;
DROP INDEX IF EXISTS shifts_one_open_per_tenant;
DROP TABLE IF EXISTS shifts;
