-- 020_paused_conversations.sql — Handoff por conversación (C4 tanda 3c).
--
-- Cuando un admin toma personalmente la conversación con un cliente, el bot
-- debe dejar de responder a ESE cliente específico (no a todos). Esta tabla
-- guarda qué conversaciones (tenant_id, customer_phone) están en handoff.
--
-- El runtime (main.py _procesar_mensaje) consulta esta tabla ANTES de llamar
-- a generar_respuesta cliente. Si hay match, guarda el mensaje del cliente
-- en historial pero NO responde — el admin está escribiendo manualmente desde
-- su WhatsApp personal.
--
-- PK compuesta (tenant_id, customer_phone) para upsert idempotente y lookup
-- constante. Un cliente solo está pausado o no — no hay múltiples pauses
-- concurrentes.

CREATE TABLE IF NOT EXISTS paused_conversations (
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_phone       TEXT NOT NULL,
  paused_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paused_by_admin_id   UUID REFERENCES tenant_admins(id) ON DELETE SET NULL,
  reason               TEXT,
  PRIMARY KEY (tenant_id, customer_phone)
);

COMMENT ON TABLE paused_conversations IS
  'Conversaciones cliente<->bot pausadas manualmente por admin (C4 tanda 3c). ' ||
  'Mientras existe fila, el runtime no responde al cliente. DELETE = reactivado.';
COMMENT ON COLUMN paused_conversations.reason IS
  'Por qué se pausó. Opcional. Útil para audit ("queja compleja", "negociación").';
