-- shared/migrations/021_agent_rules.sql
-- Reglas duras del agente por tenant. Se inyectan en el system_prompt del
-- brain cliente en cada turno. El LLM las trata como "no puedes pasar por
-- alto". Distinto de menu_overrides (time-bounded + item-level) y de
-- agent_configs.knowledge (libre-form unstructured).
--
-- Uso típico: "15 min antes del cierre solo para llevar", "no aceptamos
-- reservas de más de 8", "siempre ofrece bebida al hacer pedido", etc.

CREATE TABLE IF NOT EXISTS agent_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rule_text TEXT NOT NULL
    CHECK (length(rule_text) >= 3 AND length(rule_text) <= 500),
  active BOOLEAN NOT NULL DEFAULT true,
  -- higher priority rules se listan primero en el prompt (0-100).
  priority INTEGER NOT NULL DEFAULT 0,
  created_by_admin_id UUID REFERENCES tenant_admins(id) ON DELETE SET NULL,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_rules_tenant_active
  ON agent_rules(tenant_id, priority DESC, created_at)
  WHERE active;

ALTER TABLE agent_rules ENABLE ROW LEVEL SECURITY;

-- Mismo patrón que el resto de tablas multi-tenant.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'agent_rules' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON agent_rules
      USING (tenant_id = current_tenant_id())
      WITH CHECK (tenant_id = current_tenant_id());
  END IF;
END $$;

COMMENT ON TABLE agent_rules IS
  'Reglas duras por tenant inyectadas en el system_prompt del agente cliente.';
