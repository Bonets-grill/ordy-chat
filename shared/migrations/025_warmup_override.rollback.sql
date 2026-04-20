-- shared/migrations/025_warmup_override.rollback.sql

ALTER TABLE provider_credentials
  DROP COLUMN IF EXISTS warmup_override_at,
  DROP COLUMN IF EXISTS warmup_override_by,
  DROP COLUMN IF EXISTS warmup_override_reason,
  DROP COLUMN IF EXISTS warmup_override;
