-- Migration 056 (2026-04-26): añade reminder_sent_at a appointments para
-- soportar el cron de recordatorios T-2h por WhatsApp. NULL = aún no enviado.
-- Idempotency: el cron solo manda 1 recordatorio por reserva.
--
-- Idea operativa Mario: "el cliente reservó hace 3 días, recuérdale por WA
-- 2h antes de la cita". Antes esto no existía aunque la doc lo prometía.

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMP WITH TIME ZONE;

-- Índice parcial: el cron solo busca reservas confirmadas pendientes de
-- recordatorio en una ventana de tiempo. Sin índice, full-scan en cada tick.
CREATE INDEX IF NOT EXISTS appointments_reminder_pending_idx
  ON appointments (starts_at)
  WHERE reminder_sent_at IS NULL AND status = 'confirmed';
