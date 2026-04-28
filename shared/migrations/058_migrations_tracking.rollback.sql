-- Rollback mig 058. Borra la tabla de tracking. Las mig SQL ya aplicadas
-- al schema NO se revierten — solo se pierde el registro de qué estaba aplicado.
DROP TABLE IF EXISTS applied_migrations;
