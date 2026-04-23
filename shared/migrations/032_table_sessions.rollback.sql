-- rollback 032_table_sessions
ALTER TABLE orders DROP COLUMN IF EXISTS session_id;
DROP INDEX IF EXISTS table_sessions_active_per_table;
DROP INDEX IF EXISTS table_sessions_tenant_status_idx;
DROP TABLE IF EXISTS table_sessions;
DROP TYPE IF EXISTS table_session_status;
