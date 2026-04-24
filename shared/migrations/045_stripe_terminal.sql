-- Mig 045 — Stripe Terminal: integración TPV físico (BBPOS WisePad 3, etc.).
--
-- Contexto:
--   - Hoy el camarero marca pedidos como "pagado tarjeta" desde el KDS (mig
--     039), pero el cobro real lo hace en su TPV físico aparte. Doble paso,
--     riesgo de descuadre.
--   - Esta migración añade el soporte de DB para que el cobro se dispare desde
--     la app al lector físico (Stripe Terminal) y se confirme automáticamente
--     vía webhook payment_intent.succeeded.
--
-- Diseño:
--   1. tenants gana `stripe_account_id` + `stripe_terminal_location_id` para
--      Stripe Connect Standard. El flujo Connect (onboarding) NO está cubierto
--      por esta migración — el super admin lo pega a mano hasta que tengamos
--      el flujo OAuth montado. Documentado en el PR body.
--   2. `stripe_terminal_readers` lista los lectores físicos emparejados a
--      cada tenant. Soporta múltiples (caja principal + caja secundaria).
--   3. `pos_payments` hace de "ledger" entre la orden y el PaymentIntent —
--      multi-tenant, FK a orders, UNIQUE en payment_intent_id para idempotencia.
--
-- Idempotente: usa IF NOT EXISTS / IF NOT EXISTS en columnas e índices.

-- 1. Columnas Connect en tenants ---------------------------------------------

ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS stripe_account_id text;

ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS stripe_terminal_location_id text;

-- Índice opcional para lookups por stripe_account_id (webhooks de Connect).
CREATE INDEX IF NOT EXISTS idx_tenants_stripe_account_id
    ON tenants(stripe_account_id)
    WHERE stripe_account_id IS NOT NULL;

-- 2. Tabla stripe_terminal_readers -------------------------------------------

CREATE TABLE IF NOT EXISTS stripe_terminal_readers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    reader_id text NOT NULL,
    label text,
    serial_number text,
    status text NOT NULL DEFAULT 'offline',
    last_seen_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT stripe_terminal_readers_status_check
        CHECK (status IN ('online', 'offline'))
);

-- Un mismo Stripe reader_id no puede aparecer dos veces en el mismo tenant.
-- (En teoría tampoco entre tenants, pero como cada tenant tiene su propia
-- cuenta Stripe Connect, el reader_id solo es único dentro de esa cuenta.)
CREATE UNIQUE INDEX IF NOT EXISTS idx_stripe_terminal_readers_tenant_reader
    ON stripe_terminal_readers(tenant_id, reader_id);

CREATE INDEX IF NOT EXISTS idx_stripe_terminal_readers_tenant
    ON stripe_terminal_readers(tenant_id);

-- 3. Tabla pos_payments ------------------------------------------------------

CREATE TABLE IF NOT EXISTS pos_payments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    reader_id text,
    payment_intent_id text NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    amount_cents integer NOT NULL,
    currency text NOT NULL DEFAULT 'EUR',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pos_payments_status_check
        CHECK (status IN ('pending', 'succeeded', 'failed', 'canceled')),
    CONSTRAINT pos_payments_amount_positive
        CHECK (amount_cents > 0)
);

-- payment_intent_id único globalmente — Stripe ya garantiza unicidad.
-- Si Stripe nos manda el mismo PI dos veces, el INSERT lo rechaza y el
-- webhook handler hace UPDATE en su lugar.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_payments_payment_intent
    ON pos_payments(payment_intent_id);

CREATE INDEX IF NOT EXISTS idx_pos_payments_tenant_order
    ON pos_payments(tenant_id, order_id);

CREATE INDEX IF NOT EXISTS idx_pos_payments_status
    ON pos_payments(status)
    WHERE status = 'pending';
