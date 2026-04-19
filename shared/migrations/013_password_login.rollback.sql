-- 013_password_login.rollback.sql

DROP INDEX IF EXISTS users_password_hash_idx;

ALTER TABLE users
  DROP COLUMN IF EXISTS password_hash;
