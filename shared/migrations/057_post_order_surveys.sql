-- Migration 057 (2026-04-26): encuesta NPS post-pedido vía WhatsApp.
--
-- 24h después de marcar un pedido como pagado, dentro de la ventana
-- 14:00-20:00 (TZ del tenant), se envía un mensaje al cliente preguntando
-- cómo le fue. Patrón clonado de mig 056 (appointments-reminder).
--
-- Trigger BEFORE-INSERT pattern: cuando orders.paid_at se setea por primera
-- vez (NULL→NOT NULL), insertamos una fila pending en post_order_surveys
-- con todos los chequeos de elegibilidad. ON CONFLICT (order_id) DO NOTHING
-- garantiza idempotencia incluso si paid_at se "retoca".
--
-- El cron /api/cron/post-order-surveys (cada 15min) llama al runtime que:
--   1. SELECT pendings con scheduled_for <= now() y status='pending'.
--   2. Doble-chequea ventana horaria del tenant (defensa en profundidad).
--   3. Filtra handoffs/paused activos.
--   4. enviar_a_cliente con plantilla en el idioma detectado.
--   5. UPDATE status='sent' / 'skipped_*'.
--
-- El cliente responde con un dígito 1-5 → parser pre-brain en el webhook
-- WA captura, guarda rating, agradece y NO invoca el brain.

CREATE TABLE IF NOT EXISTS post_order_surveys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  customer_phone TEXT NOT NULL,

  -- Idempotencia natural: 1 fila por order. Si llega un retry del setter
  -- de paid_at, ON CONFLICT DO NOTHING.
  CONSTRAINT post_order_surveys_order_id_unique UNIQUE (order_id),

  status TEXT NOT NULL DEFAULT 'pending',
  CONSTRAINT post_order_surveys_status_chk CHECK (status IN (
    'pending', 'sent', 'answered', 'expired',
    'skipped_handoff', 'skipped_no_phone', 'skipped_no_creds',
    'skipped_blocked', 'skipped_test', 'skipped_dedupe',
    'skipped_subscription_inactive', 'skipped_paused'
  )),

  rating INTEGER,
  CONSTRAINT post_order_surveys_rating_chk CHECK (rating IS NULL OR (rating BETWEEN 1 AND 5)),
  feedback_text TEXT,

  -- Idioma detectado del cliente al insertar (es|en|de|fr|it|pt|null).
  -- Si null al disparo, el dispatcher lo re-detecta del historial reciente.
  client_lang TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  scheduled_for TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  answered_at TIMESTAMPTZ,

  -- Hereda is_test del order para no spammear sandbox/playground.
  is_test BOOLEAN NOT NULL DEFAULT FALSE
);

-- Índice del cron dispatcher (status='pending' AND scheduled_for <= now()).
-- Parcial para mantenerlo pequeño — surveys ya enviadas no se re-escanean.
CREATE INDEX IF NOT EXISTS post_order_surveys_dispatch_idx
  ON post_order_surveys (scheduled_for)
  WHERE status = 'pending';

-- Índice del parser de respuestas: dado un (tenant_id, customer_phone),
-- buscar la última encuesta sent con sent_at en últimas 7d.
CREATE INDEX IF NOT EXISTS post_order_surveys_phone_recent_idx
  ON post_order_surveys (tenant_id, customer_phone, sent_at DESC)
  WHERE status = 'sent';

-- Función trigger: al setear orders.paid_at por primera vez, encolar survey
-- si pasa todos los filtros de elegibilidad.
--
-- Filtros (TODOS deben cumplirse para encolar):
--   - paid_at pasó de NULL a NOT NULL.
--   - kitchen_decision = 'accepted' (no encuestar pedidos rechazados).
--   - is_test = false (no encuestar sandbox).
--   - customer_phone IS NOT NULL AND length >= 8 (necesita teléfono real).
--   - customer_phone NOT LIKE 'playground-%' (defensa extra).
--   - DEDUPE: no enviar 2 surveys al mismo (tenant_id, customer_phone) en
--     últimos 14 días — clientes recurrentes no quieren encuesta semanal.
CREATE OR REPLACE FUNCTION enqueue_post_order_survey() RETURNS TRIGGER AS $$
BEGIN
  -- Solo en transición NULL → NOT NULL del paid_at.
  IF OLD.paid_at IS NOT NULL OR NEW.paid_at IS NULL THEN
    RETURN NEW;
  END IF;

  -- Filtros de elegibilidad básicos.
  IF NEW.kitchen_decision IS DISTINCT FROM 'accepted' THEN
    RETURN NEW;
  END IF;

  IF NEW.is_test = TRUE THEN
    RETURN NEW;
  END IF;

  IF NEW.customer_phone IS NULL OR length(NEW.customer_phone) < 8 THEN
    RETURN NEW;
  END IF;

  IF NEW.customer_phone LIKE 'playground-%' THEN
    RETURN NEW;
  END IF;

  -- Dedupe 14 días.
  IF EXISTS (
    SELECT 1 FROM post_order_surveys
     WHERE tenant_id = NEW.tenant_id
       AND customer_phone = NEW.customer_phone
       AND created_at > NOW() - INTERVAL '14 days'
  ) THEN
    RETURN NEW;
  END IF;

  -- INSERT idempotente. scheduled_for = paid_at + 24h.
  INSERT INTO post_order_surveys (
    tenant_id, order_id, customer_phone, scheduled_for, is_test
  ) VALUES (
    NEW.tenant_id, NEW.id, NEW.customer_phone,
    NEW.paid_at + INTERVAL '24 hours', NEW.is_test
  )
  ON CONFLICT (order_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS post_order_survey_enqueue_trigger ON orders;
CREATE TRIGGER post_order_survey_enqueue_trigger
AFTER UPDATE OF paid_at ON orders
FOR EACH ROW
EXECUTE FUNCTION enqueue_post_order_survey();

-- COMENTARIOS para documentación inline.
COMMENT ON TABLE post_order_surveys IS
  'Encuestas NPS post-pedido enviadas por WA 24h tras pago. Trigger en orders.paid_at.';
COMMENT ON COLUMN post_order_surveys.status IS
  'pending → sent → answered (camino feliz). pending → skipped_* (no elegible). sent → expired (sin respuesta 7d).';
COMMENT ON COLUMN post_order_surveys.scheduled_for IS
  'paid_at + 24h. El dispatcher solo envía cuando NOW() >= scheduled_for AND ventana horaria 14-20h tenant TZ.';
