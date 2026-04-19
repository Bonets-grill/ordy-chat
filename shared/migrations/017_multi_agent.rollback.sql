-- 017_multi_agent.rollback.sql
DROP INDEX IF EXISTS idx_agent_invocations_agent_status;
DROP INDEX IF EXISTS idx_agent_invocations_tenant_created;
DROP INDEX IF EXISTS idx_agent_invocations_trace;
DROP TABLE IF EXISTS agent_invocations;
DROP TABLE IF EXISTS tenant_add_ons;
