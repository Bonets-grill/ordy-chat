-- 013_password_login.sql
-- Añade login directo con email + password al módulo auth (Auth.js v5 Credentials).
-- El hash se almacena con argon2id (web/lib/auth/password.ts). Nullable:
-- los usuarios creados vía magic link o Google OAuth siguen sin password_hash
-- hasta que decidan establecerlo.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Index parcial: solo usuarios con password pueden hacer login directo.
-- Evita full scan cuando el Credentials provider intenta autenticar.
CREATE INDEX IF NOT EXISTS users_password_hash_idx
  ON users (email)
  WHERE password_hash IS NOT NULL;

COMMENT ON COLUMN users.password_hash IS
  'argon2id hash (web/lib/auth/password.ts). NULL = usuario sin login directo (solo magic link / OAuth).';
