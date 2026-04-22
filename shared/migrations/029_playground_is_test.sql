-- shared/migrations/029_playground_is_test.sql
-- Flag `is_test` en tablas escritas desde el playground. Antes el playground
-- stubbaba TODAS las tools (excepto solicitar_humano) y no se persistía nada,
-- lo que hacía imposible validar end-to-end: "reserva confirmada" en el chat
-- pero 0 filas en /agent/reservations, /dashboard/conversations, KDS.
--
-- Nueva política (feedback Sandbox ≠ 100% stub):
--   - Las tools persisten de verdad cuando vienen del playground (is_test=true).
--   - Los dashboards (KDS, Reservas, Conversaciones) filtran is_test=false por
--     defecto; un toggle "🧪 Incluir pruebas" las muestra cuando el admin lo
--     activa.
--   - Los workers proactivos (kitchen → cliente por WA) saltan filas
--     is_test=true para no intentar enviar WA al customer_phone fake
--     "playground-sandbox".
--
-- El side-effect real del playground sigue siendo solicitar_humano, que ya
-- funcionaba desde PR #29 (prefija reason '[PLAYGROUND]' y prepende '🧪 PRUEBA
-- PLAYGROUND' al WA del admin). Esta mig le añade is_test=true como columna
-- explícita para poder filtrar métricas sin depender del substring del reason.
--
-- Idempotente (ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS).

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE handoff_requests
  ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false;

-- Índices parciales: acelerar el caso común (dashboards filtrando is_test=false)
-- sin penalizar la columna con un full index cuando >99% será false en prod real.
CREATE INDEX IF NOT EXISTS orders_tenant_real_idx
  ON orders (tenant_id, created_at DESC)
  WHERE is_test = false;

CREATE INDEX IF NOT EXISTS appointments_tenant_real_idx
  ON appointments (tenant_id, starts_at)
  WHERE is_test = false;

CREATE INDEX IF NOT EXISTS conversations_tenant_real_idx
  ON conversations (tenant_id, last_message_at DESC)
  WHERE is_test = false;

COMMENT ON COLUMN orders.is_test IS 'true = pedido creado desde el playground. Dashboards filtran is_test=false por defecto. Workers proactivos WA saltan filas is_test=true.';
COMMENT ON COLUMN appointments.is_test IS 'true = reserva creada desde el playground. Ver orders.is_test.';
COMMENT ON COLUMN handoff_requests.is_test IS 'true = handoff creado desde el playground. Complementa el prefijo [PLAYGROUND] del reason.';
COMMENT ON COLUMN conversations.is_test IS 'true = conversación del playground (customer_phone = playground-sandbox).';
COMMENT ON COLUMN messages.is_test IS 'true = mensaje del playground. Filtrado fuera de /dashboard/conversations por defecto.';
