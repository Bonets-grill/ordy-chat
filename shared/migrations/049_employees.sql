-- Mig 049 — Empleados (meseros) con login por PIN para el comandero.
--
-- El comandero pasa de "tenant_admin con cookie de email/magic-link" a app
-- nativa-like con keypad: cada mesero entra con su PIN de 4-6 dígitos. El
-- tenant_admin gestiona los empleados desde /agent/empleados.
--
-- Auditoría: orders.metadata.created_by_employee_id (uuid) reemplaza a
-- created_by_waiter_id en pedidos del comandero. Reportes /dashboard/ventas/
-- meseros leen ambos para retro-compat.

CREATE TABLE IF NOT EXISTS employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  -- argon2id hash del PIN (4-6 dígitos). Nunca el PIN plain.
  pin_hash text NOT NULL,
  role text NOT NULL DEFAULT 'waiter' CHECK (role IN ('waiter', 'manager')),
  active boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_employees_tenant_active
  ON employees(tenant_id, active);
