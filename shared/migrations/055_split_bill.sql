-- Mig 055 — Split bill (dividir cuenta entre N comensales).
--
-- Diseño: una "subcuenta" agrupa pagos parciales de la mesa antes del cierre
-- final. Cada subcuenta puede pagarse con su método propio (efectivo / tarjeta)
-- y opcionalmente referenciar order_items concretos (split por items) o ser
-- un split por monto (igual / personalizado).
--
-- Cuando todas las subcuentas suman >= total ajustado de la mesa, la mesa se
-- considera pagada y los orders pasan a status='paid'.
--
-- NO usamos transacciones (driver neon-http no las soporta — ver fix 24ac805).
-- Cada operación es atómica a nivel de fila.

BEGIN;

CREATE TABLE IF NOT EXISTS table_split_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- session_id NULL durante la creación inicial, lo seteamos al primer cobro.
  -- table_number redundante con session pero útil para queries directas.
  session_id uuid REFERENCES table_sessions(id) ON DELETE CASCADE,
  table_number text NOT NULL,
  -- 'item' = subcuenta cubre order_items específicos (snapshot en items_json)
  -- 'amount' = subcuenta cubre un monto en céntimos sin items específicos
  -- 'equal' = parte igual del total (N personas → total/N)
  split_kind text NOT NULL CHECK (split_kind IN ('item', 'amount', 'equal')),
  -- Snapshot de los order_items cubiertos (split_kind='item').
  -- Forma: [{order_id, order_item_id, name, quantity, unit_price_cents}]
  items_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  tip_cents integer NOT NULL DEFAULT 0 CHECK (tip_cents >= 0),
  discount_cents integer NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  payment_method text NOT NULL,
  -- 'pending' (creada, esperando confirmación cobro) | 'paid' | 'voided'
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'voided')),
  paid_at timestamptz,
  -- Etiqueta libre opcional ("Mario", "Cliente 1", "Tarjeta visa visa-1234")
  label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_split_payments_tenant_table
  ON table_split_payments(tenant_id, table_number)
  WHERE status != 'voided';
CREATE INDEX IF NOT EXISTS idx_split_payments_session
  ON table_split_payments(session_id)
  WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_split_payments_pending
  ON table_split_payments(tenant_id, table_number, status)
  WHERE status = 'pending';

COMMENT ON TABLE table_split_payments IS
  'Subcuentas para split bill (Mig 055). Una mesa puede tener varias subcuentas pendientes hasta que la suma cubra el total ajustado.';

COMMIT;
