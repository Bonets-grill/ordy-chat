-- Mig 038 — POS: turnos + vinculación de pedidos.
--
-- Un tenant abre un turno por la mañana/tarde con un efectivo inicial. Los
-- pedidos creados mientras el turno está abierto se auto-vinculan a él.
-- Al cerrar el turno, el admin cuenta el efectivo físico; la diferencia
-- vs. lo esperado queda registrada para auditoría.
--
-- Reportes:
--   - Por turno:   SUM(orders.total_cents) WHERE shift_id = X
--   - Por día:     GROUP BY paid_at::date
--   - Histórico:   shifts WHERE closed_at IS NOT NULL ORDER BY opened_at DESC

CREATE TABLE IF NOT EXISTS shifts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    opened_at timestamptz NOT NULL DEFAULT now(),
    opened_by text,                          -- phone del admin o nombre (si hay)
    closed_at timestamptz,                   -- NULL = turno activo
    closed_by text,
    opening_cash_cents integer NOT NULL DEFAULT 0 CHECK (opening_cash_cents >= 0),
    counted_cash_cents integer CHECK (counted_cash_cents IS NULL OR counted_cash_cents >= 0),
    notes text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Solo un turno abierto por tenant (closed_at IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS shifts_one_open_per_tenant
    ON shifts (tenant_id) WHERE closed_at IS NULL;

CREATE INDEX IF NOT EXISTS shifts_tenant_opened_at_idx
    ON shifts (tenant_id, opened_at DESC);

-- Vincular pedidos al turno en el que se crean.
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS shift_id uuid
    REFERENCES shifts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS orders_shift_id_idx ON orders (shift_id);
