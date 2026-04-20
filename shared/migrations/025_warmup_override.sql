-- shared/migrations/025_warmup_override.sql
-- Override per-tenant del warmup anti-ban (Evolution).
--
-- Problema: el warmup escala el cap de mensajes/día según edad de la
-- instancia (fresh=30, early=100, mid=300, mature=sin cap). Un tenant
-- con volumen real alto día 1 queda bloqueado y el único workaround
-- era back-datar `instance_created_at`, que es frágil y no deja rastro.
--
-- Con `warmup_override=true` el chequeo diario se salta para ese
-- tenant. Se mantiene el throttle 1 msg/seg por teléfono (eso es
-- ortogonal al cap diario) y el flag `burned` sigue cortando si WA
-- detecta la cuenta.
--
-- Campos:
--   warmup_override         — si TRUE, chequear_warmup devuelve blocked=false
--   warmup_override_reason  — por qué se activó (auditable)
--   warmup_override_by      — user_id del super admin que lo activó
--   warmup_override_at      — timestamp
--
-- No hay `warmup_override_until` a propósito: el override no caduca solo.
-- Si el super admin quiere devolver el tenant al warmup normal, toggle off.

ALTER TABLE provider_credentials
  ADD COLUMN IF NOT EXISTS warmup_override BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS warmup_override_reason TEXT,
  ADD COLUMN IF NOT EXISTS warmup_override_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS warmup_override_at TIMESTAMPTZ;

COMMENT ON COLUMN provider_credentials.warmup_override IS
  'Si TRUE, el cap diario del warmup anti-ban no aplica para este tenant.
   El throttle 1 msg/seg por teléfono y el flag burned siguen activos.';
