-- 017_multi_agent.sql — Infra multi-agente por tenant.

-- tenant_add_ons: flags por capacidad del agente.
CREATE TABLE IF NOT EXISTS tenant_add_ons (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  reservas_enabled BOOLEAN NOT NULL DEFAULT false,
  pedidos_enabled BOOLEAN NOT NULL DEFAULT false,
  kds_enabled BOOLEAN NOT NULL DEFAULT false,
  pos_enabled BOOLEAN NOT NULL DEFAULT false,
  webchat_enabled BOOLEAN NOT NULL DEFAULT true,
  multi_agent_enabled BOOLEAN NOT NULL DEFAULT false,
  disabled_agents TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Backfill: todos los tenants existentes tienen fila con defaults.
INSERT INTO tenant_add_ons (tenant_id)
SELECT id FROM tenants
ON CONFLICT (tenant_id) DO NOTHING;

-- agent_invocations: auditoría completa de cada llamada de agente.
CREATE TABLE IF NOT EXISTS agent_invocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id UUID,
  message_id UUID,
  trace_id UUID NOT NULL,
  agent_name TEXT NOT NULL,
  parent_invocation_id UUID REFERENCES agent_invocations(id) ON DELETE SET NULL,
  input_text TEXT,
  input_context JSONB,
  output_text TEXT,
  tools_used JSONB,
  model TEXT,
  latency_ms INTEGER,
  tokens_input INTEGER,
  tokens_output INTEGER,
  status TEXT NOT NULL DEFAULT 'success',
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_invocations_trace ON agent_invocations (trace_id);
CREATE INDEX IF NOT EXISTS idx_agent_invocations_tenant_created ON agent_invocations (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_invocations_agent_status ON agent_invocations (agent_name, status, created_at DESC);

COMMENT ON TABLE tenant_add_ons IS 'Flags multi-agente + add-ons por tenant. Bonets de prueba con todo activo.';
COMMENT ON TABLE agent_invocations IS 'Trace completo router→orchestrator→agentes para debugging y evals.';

-- Bonets Grill Icod: activar TODOS los add-ons + multi-agente ON como tenant de prueba.
UPDATE tenant_add_ons
SET reservas_enabled = true,
    pedidos_enabled = true,
    kds_enabled = true,
    pos_enabled = true,
    webchat_enabled = true,
    multi_agent_enabled = true,
    updated_at = NOW()
WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'bonets-grill-icod');
