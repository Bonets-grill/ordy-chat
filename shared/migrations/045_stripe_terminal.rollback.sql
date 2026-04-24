-- Rollback mig 045 — Stripe Terminal.

DROP INDEX IF EXISTS idx_pos_payments_status;
DROP INDEX IF EXISTS idx_pos_payments_tenant_order;
DROP INDEX IF EXISTS idx_pos_payments_payment_intent;
DROP TABLE IF EXISTS pos_payments;

DROP INDEX IF EXISTS idx_stripe_terminal_readers_tenant;
DROP INDEX IF EXISTS idx_stripe_terminal_readers_tenant_reader;
DROP TABLE IF EXISTS stripe_terminal_readers;

DROP INDEX IF EXISTS idx_tenants_stripe_account_id;
ALTER TABLE tenants DROP COLUMN IF EXISTS stripe_terminal_location_id;
ALTER TABLE tenants DROP COLUMN IF EXISTS stripe_account_id;
