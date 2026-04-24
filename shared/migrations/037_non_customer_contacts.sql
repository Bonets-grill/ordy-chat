-- Migración 037: whitelist de contactos NO-cliente (proveedores, comerciales).
--
-- Mario 2026-04-24: cuando un proveedor escribe al número del bot, el
-- agente no debe intentar tomar pedido — debe redirigir al admin.
-- Esta tabla guarda los números que el tenant marca como "no-cliente".
-- El runtime comprueba este listado ANTES de llamar al brain y, si
-- matchea, dispara handoff directo sin responder con el bot.

CREATE TABLE IF NOT EXISTS non_customer_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Teléfono E.164 sin el '+' (ej: '34612345678'). Normalizamos en la app.
  phone text NOT NULL,
  -- Etiqueta humana ("Makro", "Coca-Cola España", "Comercial X").
  label text NOT NULL,
  -- Tipo para routing posterior. Por ahora valor libre.
  kind text NOT NULL DEFAULT 'proveedor',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, phone)
);

CREATE INDEX IF NOT EXISTS non_customer_contacts_tenant_phone_idx
  ON non_customer_contacts (tenant_id, phone);
