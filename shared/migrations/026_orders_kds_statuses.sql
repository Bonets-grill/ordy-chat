-- shared/migrations/026_orders_kds_statuses.sql
-- Añade los statuses que el KDS necesita para el flujo de cocina.
--
-- Bug detectado 2026-04-22: web/app/api/kds/route.ts filtra por
-- ('pending','preparing','ready') y web/app/api/kds/advance/route.ts
-- promueve pending → preparing → ready → served. Pero el check
-- constraint orders_status_check solo aceptaba
-- ('pending','awaiting_payment','paid','refunded','canceled'), así
-- que el primer click en "Avanzar" desde el KDS rompía con
-- ERROR: new row for relation "orders" violates check constraint.
--
-- El KDS estaba completamente roto: cocina veía las cards pero no
-- podía moverlas. Ningún test cubría este flujo (solo se testea el
-- INSERT en createOrder, no la transición de estados).
--
-- Este migrate ES IDEMPOTENTE — drop & recreate del constraint.
-- No toca data existente.

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;

ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (
  status = ANY (ARRAY[
    'pending',
    'awaiting_payment',
    'paid',
    'refunded',
    'canceled',
    -- Estados del flujo KDS de cocina:
    'preparing',  -- la cocina aceptó y está cocinando
    'ready',      -- listo para entregar/recoger
    'served'      -- entregado al cliente (final state)
  ])
);

COMMENT ON CONSTRAINT orders_status_check ON orders IS
  'Estados válidos: 5 financieros (pending/awaiting_payment/paid/refunded/canceled)
   + 3 KDS de cocina (preparing/ready/served). El advance del KDS sigue:
   pending -> preparing -> ready -> served (final).';
