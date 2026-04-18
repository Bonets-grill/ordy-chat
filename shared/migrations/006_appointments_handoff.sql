-- 006_appointments_handoff.sql
-- Agent-2: tools reales (agendar_cita + solicitar_humano) necesitan persistencia.
-- Antes, el bot prometía "tu cita queda agendada" sin guardar nada — mentía.

-- ── Citas/reservas ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS appointments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    customer_phone TEXT NOT NULL,
    customer_name TEXT,
    starts_at TIMESTAMPTZ NOT NULL,
    duration_min INTEGER NOT NULL DEFAULT 30 CHECK (duration_min > 0),
    title TEXT NOT NULL,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'confirmed', 'canceled', 'completed', 'no_show')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_appointments_tenant_time
    ON appointments(tenant_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_appointments_phone
    ON appointments(tenant_id, customer_phone);

-- RLS (defense-in-depth igual que el resto de tablas tenant)
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON appointments;
CREATE POLICY tenant_isolation ON appointments
    FOR ALL
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

-- ── Handoff requests (escalado a humano) ───────────────────
CREATE TABLE IF NOT EXISTS handoff_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
    customer_phone TEXT NOT NULL,
    customer_name TEXT,
    reason TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'normal'
        CHECK (priority IN ('low', 'normal', 'urgent')),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'handled', 'dismissed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    handled_at TIMESTAMPTZ,
    handled_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_handoff_tenant_status
    ON handoff_requests(tenant_id, status, created_at DESC);

ALTER TABLE handoff_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON handoff_requests;
CREATE POLICY tenant_isolation ON handoff_requests
    FOR ALL
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());
