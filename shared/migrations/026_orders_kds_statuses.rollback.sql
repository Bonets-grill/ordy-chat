-- shared/migrations/026_orders_kds_statuses.rollback.sql
--
-- ATENCIÓN: este rollback FALLA si hay rows con status preparing/ready/served.
-- Hay que migrarlas antes a algún status del set original. No corras este
-- rollback en prod sin auditar primero las rows afectadas.

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;

ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (
  status = ANY (ARRAY['pending','awaiting_payment','paid','refunded','canceled'])
);
