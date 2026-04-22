-- shared/migrations/029_playground_is_test.rollback.sql
-- Revierte la mig 029. Usar solo si hay que eliminar por completo el feature
-- playground-persiste-real. Cualquier fila con is_test=true se perderá al
-- eliminar la columna (DROP COLUMN no preserva nada) — confirmar antes que no
-- hay análisis en curso sobre las filas de test.

DROP INDEX IF EXISTS conversations_tenant_real_idx;
DROP INDEX IF EXISTS appointments_tenant_real_idx;
DROP INDEX IF EXISTS orders_tenant_real_idx;

ALTER TABLE messages          DROP COLUMN IF EXISTS is_test;
ALTER TABLE conversations     DROP COLUMN IF EXISTS is_test;
ALTER TABLE handoff_requests  DROP COLUMN IF EXISTS is_test;
ALTER TABLE appointments      DROP COLUMN IF EXISTS is_test;
ALTER TABLE orders            DROP COLUMN IF EXISTS is_test;
