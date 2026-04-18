-- 007_payment_methods_faqs.sql
-- Fix-pay: el tenant declara qué métodos de pago acepta. El agente NUNCA
-- promete "link de pago online" si accept_online_payment=false.
--
-- Fix-faq: tabla estructurada de FAQs editables por el tenant. Se inyectan
-- al system prompt con prioridad alta.

-- ── payment methods ─────────────────────────────────────────
ALTER TABLE agent_configs
    ADD COLUMN IF NOT EXISTS payment_methods TEXT[] NOT NULL DEFAULT ARRAY['on_pickup','cash']::text[],
    ADD COLUMN IF NOT EXISTS accept_online_payment BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS payment_notes TEXT;

COMMENT ON COLUMN agent_configs.payment_methods IS 'Métodos que acepta el tenant: online, on_pickup, on_delivery, cash, card_in_person, bizum';
COMMENT ON COLUMN agent_configs.accept_online_payment IS 'Gate para intentar Stripe Checkout. Si false, el bot no prometerá link.';

-- ── FAQs estructuradas ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS faqs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_faqs_tenant ON faqs(tenant_id, order_index);

ALTER TABLE faqs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON faqs;
CREATE POLICY tenant_isolation ON faqs
    FOR ALL
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());
