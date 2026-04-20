-- shared/migrations/022_agent_feedback.sql
-- Feedback del tenant sobre respuestas del agente (desde /dashboard/playground).
-- El tenant prueba el agente con chips o preguntas libres y puntúa la
-- respuesta 👍/👎. El 👎 envía email al super_admin para que le ayude.

CREATE TABLE IF NOT EXISTS agent_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  user_message TEXT NOT NULL CHECK (length(user_message) <= 4000),
  bot_response TEXT NOT NULL CHECK (length(bot_response) <= 8000),
  verdict TEXT NOT NULL CHECK (verdict IN ('up', 'down')),
  -- Libre — qué debería haber dicho el bot según el operador.
  reason TEXT CHECK (reason IS NULL OR length(reason) <= 2000),
  -- 'chip:<id>' | 'free' | 'context-reply'. Para estadísticas.
  source TEXT NOT NULL DEFAULT 'free',
  super_admin_notified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_feedback_tenant_created
  ON agent_feedback(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_feedback_down_pending
  ON agent_feedback(created_at DESC)
  WHERE verdict = 'down' AND super_admin_notified = false;

ALTER TABLE agent_feedback ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'agent_feedback' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON agent_feedback
      USING (tenant_id = current_tenant_id())
      WITH CHECK (tenant_id = current_tenant_id());
  END IF;
END $$;

COMMENT ON TABLE agent_feedback IS
  'Feedback del operador del tenant sobre respuestas del agente en el playground.';
