-- Rollback de mig 056: reminder_sent_at + index parcial.
DROP INDEX IF EXISTS appointments_reminder_pending_idx;
ALTER TABLE appointments DROP COLUMN IF EXISTS reminder_sent_at;
