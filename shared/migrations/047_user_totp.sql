-- Mig 047 — TOTP 2FA en users.
--
-- Cierra el TODO post-MVP de TOTP en aprobación de payouts. Permite que un
-- super_admin tenga 2FA TOTP RFC 6238. Cuando el usuario tiene
-- totp_enabled_at != NULL, el endpoint POST /api/admin/payouts/:id/approve
-- requiere el campo `totp_token` en el body y lo verifica con otpauth.
--
-- Estados:
--   - totp_secret_encrypted = NULL, totp_enabled_at = NULL → no configurado
--   - totp_secret_encrypted != NULL, totp_enabled_at = NULL → setup pendiente
--     (se generó el secret pero el usuario aún no confirmó el primer token)
--   - totp_secret_encrypted != NULL, totp_enabled_at != NULL → activo
--
-- El secret se cifra con AES-256-GCM (helpers cifrar/descifrar) usando
-- ENCRYPTION_KEY. Mismo flujo que provider_credentials.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS totp_secret_encrypted text,
  ADD COLUMN IF NOT EXISTS totp_enabled_at timestamptz;
