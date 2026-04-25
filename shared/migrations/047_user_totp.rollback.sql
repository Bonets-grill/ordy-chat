-- Rollback Mig 047 — Quita columnas TOTP.
ALTER TABLE users
  DROP COLUMN IF EXISTS totp_secret_encrypted,
  DROP COLUMN IF EXISTS totp_enabled_at;
