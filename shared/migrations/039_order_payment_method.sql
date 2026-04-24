-- Mig 039 — POS: método de pago por pedido.
--
-- Hasta ahora el cierre de turno (mig 038) asumía que TODO pedido cobrado era
-- efectivo y sumaba a "esperado caja". Eso es falso: muchos cobros son tarjeta.
-- Con este campo, el cuadre solo cuenta cash (+ NULL por retro-compat con
-- pedidos viejos) como efectivo esperado. El total general sigue siendo la
-- suma de todo.
--
-- Valores:
--   'cash'     — efectivo contante (entra en cuadre de caja)
--   'card'     — TPV físico o Stripe
--   'transfer' — Bizum, transferencia, etc.
--   'other'    — cheque-gourmet, vale, etc.
--   NULL       — pedidos pre-mig 039 (se tratan como cash por retro-compat)
--
-- La web mantiene una constante compartida en `web/lib/payment-methods.ts`
-- con el mismo set — no hardcodear en 5 sitios.

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS payment_method text
    CHECK (payment_method IN ('cash', 'card', 'transfer', 'other'));

-- Index para agregaciones del dashboard POS: "dame la suma de cash/card/... de
-- los pedidos pagados de este turno". Parcial (solo paid_at IS NOT NULL) para
-- no crecer por cada carrito abandonado.
CREATE INDEX IF NOT EXISTS orders_tenant_payment_method_paid_idx
    ON orders (tenant_id, payment_method)
    WHERE paid_at IS NOT NULL;
