-- Rollback mig 039
DROP INDEX IF EXISTS orders_tenant_payment_method_paid_idx;
ALTER TABLE orders DROP COLUMN IF EXISTS payment_method;
