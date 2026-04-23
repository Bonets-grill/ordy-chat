-- Migración 035: plano de mesas del restaurante.
--
-- Hasta ahora el widget público /m/<slug>?mesa=N aceptaba CUALQUIER
-- número de mesa sin validar. El tenant no podía gestionar mesas ni
-- imprimir QRs desde el admin. Mario (2026-04-23): "¿dónde se crea el
-- plano de mesas y los QR para las mesas?"
--
-- Esta migración añade la tabla canónica de mesas. `number` es texto
-- para permitir nombres como "T1", "Terraza-3", no sólo numéricos.

CREATE TABLE IF NOT EXISTS restaurant_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Identificador que viaja en la URL del QR (/m/<slug>?mesa=<number>).
  -- Hasta 8 chars, validado por regex en la API.
  number text NOT NULL,
  -- Zona opcional para agrupar ("Terraza", "Interior", "Barra").
  zone text,
  -- Nº de comensales sugerido (opcional, informativo).
  seats integer NOT NULL DEFAULT 4,
  -- Si está inactiva no acepta pedidos (para mesas temporales o rotas).
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, number)
);

CREATE INDEX IF NOT EXISTS restaurant_tables_tenant_idx
  ON restaurant_tables (tenant_id, active);
