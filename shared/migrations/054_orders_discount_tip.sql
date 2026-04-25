-- Mig 054 — POS comandero: descuentos y propinas por pedido.
--
-- Antes: el cobro desde /agent/comandero solo aceptaba método (cash/card)
-- y total tal cual. No había forma de aplicar descuentos ni recoger propina.
--
-- Ahora: orders.discount_cents (descuento sobre subtotal antes de impuestos)
-- + orders.tip_cents (propina extra que el cliente decide).
-- Total final = subtotal - discount + tax + tip. La columna total_cents
-- existente sigue reflejando subtotal+tax (compat reporting). El "total
-- cobrado" se computa: total_cents - discount_cents + tip_cents.

BEGIN;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS discount_cents integer NOT NULL DEFAULT 0
    CHECK (discount_cents >= 0),
  ADD COLUMN IF NOT EXISTS tip_cents integer NOT NULL DEFAULT 0
    CHECK (tip_cents >= 0);

COMMENT ON COLUMN orders.discount_cents IS
  'Descuento aplicado al cobrar (en céntimos, >=0). El comandero lo introduce desde el POS.';
COMMENT ON COLUMN orders.tip_cents IS
  'Propina añadida al cobrar (en céntimos, >=0). NO modifica total_cents — se suma aparte al cobro real.';

COMMIT;
