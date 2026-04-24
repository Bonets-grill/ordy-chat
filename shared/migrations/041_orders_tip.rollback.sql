-- Rollback Mig 041 — drop tip_cents.
-- ATENCIÓN: pierde toda la información de propinas guardada.

DROP INDEX IF EXISTS orders_tenant_paid_tip_idx;

ALTER TABLE orders
    DROP COLUMN IF EXISTS tip_cents;
