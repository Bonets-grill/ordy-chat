-- shared/migrations/032_table_sessions.sql
-- Sesión de mesa — el concepto de "mesa abierta" de restaurante trasladado a DB.
--
-- Por qué: hoy cada pedido es una fila suelta en `orders`. El flujo real en un
-- restaurante es "una mesa tiene una cuenta abierta que acumula pedidos hasta
-- que se cobra". Sin este modelo, cerrar el chat pierde la conversación, y
-- no hay un sitio canónico donde llevar el estado "¿se puede pedir la cuenta?".
--
-- Estados:
--   pending  → sesión creada, aún NINGÚN pedido aceptado por cocina.
--   active   → al menos 1 pedido con kitchen_decision='accepted'. Cliente
--              ya puede "pedir la cuenta".
--   billing  → cliente pidió la cuenta, camarero notificado. Aún se puede
--              seguir añadiendo (cierre no definitivo hasta cobrar).
--   paid     → cobrado (Stripe o efectivo/terminal por camarero).
--   closed   → limpieza final (cron tras paid + 5 min, o reapertura manual).
--
-- Una única sesión NO-cerrada por (tenant_id, table_number) — la unique partial
-- garantiza que al reescanear QR en la misma mesa caigas en la misma sesión.
--
-- Idempotente.

-- Enum de estados.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'table_session_status') THEN
    CREATE TYPE table_session_status AS ENUM ('pending', 'active', 'billing', 'paid', 'closed');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS table_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Texto para soportar "3", "B2", "VIP1". Validado en API con alfanumérico + "-".
  table_number TEXT NOT NULL,
  status table_session_status NOT NULL DEFAULT 'pending',
  -- Total acumulado en céntimos (suma de orders.total_cents linkeados).
  -- Mantenemos denormalizado para no JOIN en la cabecera del chat.
  total_cents INTEGER NOT NULL DEFAULT 0,
  -- Cuándo el cliente pidió la cuenta (transición pending/active → billing).
  bill_requested_at TIMESTAMPTZ,
  -- Cuándo se cobró (Stripe webhook o waiter mark-paid).
  paid_at TIMESTAMPTZ,
  -- 'stripe' | 'cash' | 'card_terminal'
  payment_method TEXT,
  -- Session Stripe de Checkout (nullable si el cobro fue en persona).
  stripe_checkout_session_id TEXT UNIQUE,
  -- Cuándo se cerró la mesa definitivamente (cron o manual).
  closed_at TIMESTAMPTZ,
  -- Playground compat (mig 029).
  is_test BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Partial unique: solo puede haber UNA sesión "viva" por mesa del tenant.
-- paid y closed no cuentan — una nueva sesión para la misma mesa puede abrir
-- una vez la anterior haya transicionado a closed.
CREATE UNIQUE INDEX IF NOT EXISTS table_sessions_active_per_table
  ON table_sessions (tenant_id, table_number)
  WHERE status NOT IN ('paid', 'closed');

CREATE INDEX IF NOT EXISTS table_sessions_tenant_status_idx
  ON table_sessions (tenant_id, status);

COMMENT ON TABLE table_sessions IS
  'Sesión de mesa: acumula pedidos hasta que se cobra. Una activa por (tenant, mesa).';
COMMENT ON COLUMN table_sessions.total_cents IS
  'Denormalizado — suma de orders.total_cents linkeados. Recalcular en trigger o en crear_pedido.';

-- Link de órdenes a sesión (nullable por retrocompat: órdenes pre-032 no tienen).
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS session_id UUID
    REFERENCES table_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS orders_session_id_idx
  ON orders (session_id) WHERE session_id IS NOT NULL;

COMMENT ON COLUMN orders.session_id IS
  'Sesión de mesa (mig 032) — NULL en órdenes viejas o takeaway sin mesa.';
