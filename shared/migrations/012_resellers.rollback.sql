-- shared/migrations/012_resellers.rollback.sql
-- Rollback de la migracion 012_resellers.sql
-- Dropea triggers anti-delete PRIMERO (si no, DROP TABLE falla).

BEGIN;

-- Triggers anti-delete primero
DROP TRIGGER IF EXISTS trg_reseller_payouts_no_delete ON reseller_payouts;
DROP TRIGGER IF EXISTS trg_reseller_commissions_no_delete ON reseller_commissions;
DROP TRIGGER IF EXISTS trg_resellers_no_delete ON resellers;

-- updated_at triggers
DROP TRIGGER IF EXISTS trg_reseller_payouts_updated_at ON reseller_payouts;
DROP TRIGGER IF EXISTS trg_reseller_commissions_updated_at ON reseller_commissions;
DROP TRIGGER IF EXISTS trg_resellers_updated_at ON resellers;

-- Columna tenants
ALTER TABLE tenants DROP COLUMN IF EXISTS reseller_id;

-- Tablas en orden inverso de dependencia
DROP TABLE IF EXISTS reseller_self_billing_consents;
DROP TABLE IF EXISTS reseller_commissions;
DROP TABLE IF EXISTS reseller_payouts;
DROP TABLE IF EXISTS ref_touches;
DROP TABLE IF EXISTS resellers;

INSERT INTO audit_log (action, entity, metadata)
VALUES ('migration.rolled_back', 'resellers',
        jsonb_build_object('version', '012', 'rolled_back_at', now()));

COMMIT;
