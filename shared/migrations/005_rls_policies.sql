-- 005_rls_policies.sql
-- Defense-in-depth multi-tenant: si algún día un bug olvida WHERE tenant_id,
-- Postgres bloquea la query vía RLS. HIGH-4 del audit.
--
-- Estado "dormido": RLS queda ENABLED con policies que leen el GUC
-- `app.current_tenant_id`. Mientras Drizzle/asyncpg se conecten como
-- `neondb_owner` (superuser Neon), RLS NO aplica porque Postgres lo bypassea
-- en superusers. Para ACTIVAR la defensa:
--   1. Crear un role non-superuser en Neon: CREATE ROLE ordy_app LOGIN PASSWORD '...'
--   2. GRANT pertinente sobre schema public
--   3. Cambiar DATABASE_URL en Vercel+Railway a la connection string de ordy_app
--   4. En cada request server-side, antes de la query principal:
--        SET LOCAL app.current_tenant_id = '<uuid-del-tenant>'
--      (helper withTenant(id, fn) en lib/db/rls.ts)
--
-- La transición se puede hacer tabla por tabla si se prefiere.

-- ── Función helper para leer el setting con fallback a NULL ─────────
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
    SELECT CASE
        WHEN current_setting('app.current_tenant_id', true) IS NULL
          OR current_setting('app.current_tenant_id', true) = ''
        THEN NULL::uuid
        ELSE current_setting('app.current_tenant_id', true)::uuid
    END
$$;

COMMENT ON FUNCTION current_tenant_id() IS 'RLS helper: devuelve uuid del tenant activo via GUC app.current_tenant_id, NULL si no seteado';

-- ── Tablas con tenant_id (policy basada en current_tenant_id()) ────
-- En cada tabla: enable RLS + policy SELECT/INSERT/UPDATE/DELETE para el tenant.
-- El owner (neondb_owner) sigue teniendo acceso completo por ser superuser.

-- tenants: el propio uuid debe matchear
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tenants;
CREATE POLICY tenant_isolation ON tenants
    FOR ALL
    USING (id = current_tenant_id())
    WITH CHECK (id = current_tenant_id());

-- tenant_members: filtrado por tenant_id
ALTER TABLE tenant_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tenant_members;
CREATE POLICY tenant_isolation ON tenant_members
    FOR ALL
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

-- agent_configs
ALTER TABLE agent_configs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON agent_configs;
CREATE POLICY tenant_isolation ON agent_configs
    FOR ALL
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

-- provider_credentials
ALTER TABLE provider_credentials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON provider_credentials;
CREATE POLICY tenant_isolation ON provider_credentials
    FOR ALL
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

-- conversations
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON conversations;
CREATE POLICY tenant_isolation ON conversations
    FOR ALL
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

-- messages
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON messages;
CREATE POLICY tenant_isolation ON messages
    FOR ALL
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

-- processed_messages
ALTER TABLE processed_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON processed_messages;
CREATE POLICY tenant_isolation ON processed_messages
    FOR ALL
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

-- tenant_fiscal_config (migración 003)
ALTER TABLE tenant_fiscal_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tenant_fiscal_config;
CREATE POLICY tenant_isolation ON tenant_fiscal_config
    FOR ALL
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

-- orders
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON orders;
CREATE POLICY tenant_isolation ON orders
    FOR ALL
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

-- order_items
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON order_items;
CREATE POLICY tenant_isolation ON order_items
    FOR ALL
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

-- receipts
ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON receipts;
CREATE POLICY tenant_isolation ON receipts
    FOR ALL
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

-- audit_log: tenant_id nullable (eventos super_admin tienen tenant_id=NULL).
-- Policy acepta si tenant_id coincide O si es NULL (eventos globales).
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON audit_log;
CREATE POLICY tenant_isolation ON audit_log
    FOR ALL
    USING (tenant_id = current_tenant_id() OR tenant_id IS NULL)
    WITH CHECK (tenant_id = current_tenant_id() OR tenant_id IS NULL);

-- ── Tablas globales (sin tenant_id) ────────────────────────────────
-- NO activamos RLS en users, accounts, sessions, verification_tokens,
-- platform_settings, stripe_events — son globales o de Auth.js. El role
-- non-superuser (cuando exista) tendrá GRANT solo sobre estas globales que
-- necesite la app (ej. users para session lookup).
