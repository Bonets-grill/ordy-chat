-- 018_tenant_admins.rollback.sql
DROP INDEX IF EXISTS idx_tenant_admins_tenant_phone;
DROP TABLE IF EXISTS tenant_admins;
