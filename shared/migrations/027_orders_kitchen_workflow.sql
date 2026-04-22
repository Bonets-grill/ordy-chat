-- shared/migrations/027_orders_kitchen_workflow.sql
-- Workflow robusto cocina ↔ cliente. Cuando un cliente hace un pedido por
-- WhatsApp, ya NO va directo a "pending" en cocina. El flujo nuevo es:
--
--   1. Bot crea orden con status='pending_kitchen_review' + order_type
--      (dine_in con table_number, o takeaway con customer_name).
--   2. Cocina ve la card en KDS sección "pendientes de aceptar".
--   3. Cocina acepta con ETA (10/15/20/25/30/35/45 min) → kitchen_decision='accepted'
--      + pickup_eta_minutes=X. Backend dispara WA al cliente con la propuesta.
--   4. Cliente acepta/rechaza ETA → customer_eta_decision='accepted'|'rejected'.
--      Si acepta → status='preparing' (flujo KDS normal sigue).
--      Si rechaza → status='canceled'.
--   5. Si cocina rechaza → kitchen_decision='rejected' + razón. Backend
--      dispara WA al cliente con la razón (y si es "fuera de stock X",
--      el bot sugiere alternativa).
--
-- Backwards compat: orders existentes en 'pending' siguen su curso normal
-- (no se migran a 'pending_kitchen_review'). El backfill de order_type
-- usa table_number IS NOT NULL como heurística (las orders ya creadas).
--
-- Idempotente: usa IF NOT EXISTS y DROP CONSTRAINT IF EXISTS.

-- Nuevas columnas (añadir solo si no existen — idempotente).
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS order_type TEXT,
  ADD COLUMN IF NOT EXISTS pickup_eta_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS kitchen_decision TEXT,
  ADD COLUMN IF NOT EXISTS kitchen_decision_reason TEXT,
  ADD COLUMN IF NOT EXISTS customer_eta_decision TEXT;

-- Backfill: orders existentes deducimos el tipo del table_number.
UPDATE orders
SET order_type = CASE
  WHEN table_number IS NOT NULL AND table_number <> '' THEN 'dine_in'
  ELSE 'takeaway'
END
WHERE order_type IS NULL;

UPDATE orders
SET kitchen_decision = 'accepted'
WHERE kitchen_decision IS NULL;
-- (orders existentes ya estaban implícitamente "aceptadas" porque la cocina
--  las estaba viendo. Marcamos accepted para mantener consistencia.)

-- NOT NULL + defaults para futuras inserts.
ALTER TABLE orders
  ALTER COLUMN order_type SET DEFAULT 'takeaway',
  ALTER COLUMN order_type SET NOT NULL,
  ALTER COLUMN kitchen_decision SET DEFAULT 'pending',
  ALTER COLUMN kitchen_decision SET NOT NULL;

-- Check constraints para los enums.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_order_type_check;
ALTER TABLE orders ADD CONSTRAINT orders_order_type_check CHECK (
  order_type = ANY (ARRAY['dine_in','takeaway'])
);

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_kitchen_decision_check;
ALTER TABLE orders ADD CONSTRAINT orders_kitchen_decision_check CHECK (
  kitchen_decision = ANY (ARRAY['pending','accepted','rejected'])
);

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_customer_eta_decision_check;
ALTER TABLE orders ADD CONSTRAINT orders_customer_eta_decision_check CHECK (
  customer_eta_decision IS NULL OR customer_eta_decision = ANY (ARRAY['pending','accepted','rejected'])
);

-- Status nuevo: 'pending_kitchen_review'. Añadimos al check constraint
-- existente (mig 026) sin quitar ninguno de los anteriores.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (
  status = ANY (ARRAY[
    'pending',
    'pending_kitchen_review',  -- NUEVO: a la espera de aceptar/rechazar cocina
    'awaiting_payment',
    'paid',
    'refunded',
    'canceled',
    'preparing',
    'ready',
    'served'
  ])
);

-- Pickup ETA solo válido entre 5 y 120 minutos (sanity).
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_pickup_eta_check;
ALTER TABLE orders ADD CONSTRAINT orders_pickup_eta_check CHECK (
  pickup_eta_minutes IS NULL OR (pickup_eta_minutes >= 5 AND pickup_eta_minutes <= 120)
);

-- Index para que el KDS query "pendientes de aceptar" sea instant.
CREATE INDEX IF NOT EXISTS orders_pending_kitchen_review_idx
  ON orders (tenant_id, created_at DESC)
  WHERE status = 'pending_kitchen_review';

COMMENT ON COLUMN orders.order_type IS 'dine_in (comer aquí, requiere table_number) | takeaway (llevar, requiere customer_name)';
COMMENT ON COLUMN orders.pickup_eta_minutes IS 'Tiempo en minutos que la cocina prometió, set cuando kitchen_decision=accepted';
COMMENT ON COLUMN orders.kitchen_decision IS 'pending → accepted (con ETA) | rejected (con razón). Default pending para órdenes nuevas que entran como pending_kitchen_review';
COMMENT ON COLUMN orders.kitchen_decision_reason IS 'Razón cuando kitchen_decision=rejected. Si empieza por "stock:", el bot sugiere alternativa al cliente';
COMMENT ON COLUMN orders.customer_eta_decision IS 'NULL hasta que cocina acepta. Luego pending → accepted (sigue a preparing) | rejected (cancela)';
