-- Rollback Mig 049
DROP INDEX IF EXISTS idx_employees_tenant_active;
DROP TABLE IF EXISTS employees;
