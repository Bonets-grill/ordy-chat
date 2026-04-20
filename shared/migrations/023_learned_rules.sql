-- shared/migrations/023_learned_rules.sql
-- Reglas "aprendidas" automáticamente desde conversations reales del tenant.
-- Diferente de agent_rules (que es el conjunto activo):
--   learned_rules_pending = propuestas sin aprobar por el tenant/super-admin.
-- Flow:
--   1) Cron diario /internal/learning/run lee últimas N conversaciones del
--      tenant y extrae patrones con Claude Opus 4.7.
--   2) Inserta cada regla propuesta como status='pending' aquí.
--   3) Tenant entra a /dashboard/learning (o super admin a /admin/learning)
--      → aprueba/rechaza. Aprobada → INSERT en agent_rules + status='approved'.
--      Rechazada → status='rejected'.

CREATE TABLE IF NOT EXISTS learned_rules_pending (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Texto de la regla propuesta (max 500 como agent_rules.rule_text).
  rule_text TEXT NOT NULL CHECK (length(rule_text) >= 3 AND length(rule_text) <= 500),
  -- Por qué Claude propuso esta regla (ejemplo del chat original).
  evidence TEXT CHECK (evidence IS NULL OR length(evidence) <= 2000),
  -- Priority sugerida (0-100). El operador puede ajustar al aprobar.
  suggested_priority INTEGER NOT NULL DEFAULT 50
    CHECK (suggested_priority >= 0 AND suggested_priority <= 100),
  -- Rango de conversaciones analizadas para generar la regla.
  source_window_start TIMESTAMPTZ,
  source_window_end TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'superseded')),
  -- Si se aprueba: id del agent_rules creado. Si se rechaza: null.
  applied_rule_id UUID REFERENCES agent_rules(id) ON DELETE SET NULL,
  reviewed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_learned_rules_tenant_status
  ON learned_rules_pending(tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_learned_rules_pending_queue
  ON learned_rules_pending(created_at DESC)
  WHERE status = 'pending';

ALTER TABLE learned_rules_pending ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'learned_rules_pending' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON learned_rules_pending
      USING (tenant_id = current_tenant_id())
      WITH CHECK (tenant_id = current_tenant_id());
  END IF;
END $$;

-- Registro de ejecuciones del cron — para auditoría + métricas de coste.
CREATE TABLE IF NOT EXISTS learning_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  messages_analyzed INTEGER NOT NULL DEFAULT 0,
  rules_proposed INTEGER NOT NULL DEFAULT 0,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_learning_runs_tenant_created
  ON learning_runs(tenant_id, created_at DESC);

COMMENT ON TABLE learned_rules_pending IS
  'Propuestas de reglas generadas por el cron de auto-aprendizaje.';
COMMENT ON TABLE learning_runs IS
  'Registro de ejecuciones del cron de auto-aprendizaje (métricas + errores).';
