-- Migration 058 (2026-04-28): tracking de migraciones aplicadas.
--
-- Hasta hoy las mig se aplicaban a mano contra Neon sin registro de qué
-- estaba aplicado. Audit-prod 2026-04-27 lo flaggeó como riesgo MEDIUM:
-- al escalar a 5+ tenants, alguien deploya código que asume mig N+1
-- aplicada cuando no lo está → bug silencioso.
--
-- Esta tabla + el script web/scripts/apply-migrations.ts cierran el bucle:
--   - sha256 por archivo detecta drift (mig modificada después de aplicar)
--   - applied_at registra cuándo se aplicó cada una
--   - applied_by deja huella humana (env USER o CI job id)
--
-- Backfill: el script al primer run detecta la tabla vacía + las mig 001-057
-- ya aplicadas en prod (verificable porque las tablas existen) y popula
-- la tabla con sha256 de los archivos en disco + applied_at = NULL para
-- marcar "aplicada antes del tracking, no auditable".

CREATE TABLE IF NOT EXISTS applied_migrations (
  name        TEXT PRIMARY KEY,
  sha256      TEXT NOT NULL,
  applied_at  TIMESTAMPTZ,
  applied_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- No es multi-tenant — es metadata global de la plataforma. Sin RLS.

COMMENT ON TABLE applied_migrations IS
  'Registro de migraciones SQL aplicadas. Gestionado por web/scripts/apply-migrations.ts. NO escribir a mano.';
COMMENT ON COLUMN applied_migrations.sha256 IS
  'SHA-256 del contenido del archivo .sql al momento de aplicarlo. Drift detection: si el archivo cambia tras aplicarse, el script aborta.';
COMMENT ON COLUMN applied_migrations.applied_at IS
  'NULL para mig backfilled (legacy 001-057 aplicadas antes del tracking). NOT NULL para mig aplicadas por el script desde 058 en adelante.';
