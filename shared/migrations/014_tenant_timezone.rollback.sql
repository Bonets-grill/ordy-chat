-- 014_tenant_timezone.rollback.sql

ALTER TABLE tenants DROP COLUMN IF EXISTS timezone;
