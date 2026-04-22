-- shared/migrations/027_orders_kitchen_workflow.rollback.sql
--
-- ATENCIÓN: este rollback FALLA si hay rows con status='pending_kitchen_review'.
-- Hay que migrarlas a 'pending' antes (las pendientes) o 'canceled' (las que
-- nunca recibieron decisión). NO corras este rollback en prod sin auditar.

-- Volver al check constraint sin pending_kitchen_review.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (
  status = ANY (ARRAY[
    'pending','awaiting_payment','paid','refunded','canceled',
    'preparing','ready','served'
  ])
);

DROP INDEX IF EXISTS orders_pending_kitchen_review_idx;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_pickup_eta_check;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_customer_eta_decision_check;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_kitchen_decision_check;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_order_type_check;

ALTER TABLE orders
  ALTER COLUMN kitchen_decision DROP NOT NULL,
  ALTER COLUMN kitchen_decision DROP DEFAULT,
  ALTER COLUMN order_type DROP NOT NULL,
  ALTER COLUMN order_type DROP DEFAULT;

ALTER TABLE orders
  DROP COLUMN IF EXISTS customer_eta_decision,
  DROP COLUMN IF EXISTS kitchen_decision_reason,
  DROP COLUMN IF EXISTS kitchen_decision,
  DROP COLUMN IF EXISTS pickup_eta_minutes,
  DROP COLUMN IF EXISTS order_type;
