-- ═══════════════════════════════════════════════════════════
-- Ordy Chat — Schema Postgres multi-tenant
-- Fuente de verdad. Aplicado al proyecto Neon "ordy-chat".
-- ═══════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Auth.js ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    email_verified TIMESTAMPTZ,
    image TEXT,
    role TEXT NOT NULL DEFAULT 'tenant_admin'
        CHECK (role IN ('super_admin', 'tenant_admin')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS accounts (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    provider TEXT NOT NULL,
    provider_account_id TEXT NOT NULL,
    refresh_token TEXT,
    access_token TEXT,
    expires_at BIGINT,
    id_token TEXT,
    scope TEXT,
    session_state TEXT,
    token_type TEXT,
    PRIMARY KEY (provider, provider_account_id)
);

CREATE TABLE IF NOT EXISTS sessions (
    session_token TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS verification_tokens (
    identifier TEXT NOT NULL,
    token TEXT NOT NULL,
    expires TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (identifier, token)
);

-- ── Tenants ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subscription_status TEXT NOT NULL DEFAULT 'trialing'
        CHECK (subscription_status IN ('trialing', 'active', 'past_due', 'canceled', 'unpaid')),
    stripe_customer_id TEXT UNIQUE,
    stripe_subscription_id TEXT UNIQUE,
    trial_ends_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
    -- Datos fiscales + branding (migración 003).
    legal_name TEXT,
    tax_id TEXT,
    billing_address TEXT,
    billing_postal_code TEXT,
    billing_city TEXT,
    billing_country TEXT NOT NULL DEFAULT 'ES',
    brand_color TEXT NOT NULL DEFAULT '#7c3aed',
    brand_logo_url TEXT,
    default_vat_rate NUMERIC(5,2) NOT NULL DEFAULT 10.00,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenants_owner ON tenants(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_tenants_sub_status ON tenants(subscription_status);

CREATE TABLE IF NOT EXISTS tenant_members (
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'member')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, user_id)
);

-- ── Configuración del agente por tenant ────────────────────
CREATE TABLE IF NOT EXISTS agent_configs (
    tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    business_name TEXT NOT NULL,
    business_description TEXT NOT NULL DEFAULT '',
    agent_name TEXT NOT NULL DEFAULT 'Asistente',
    tone TEXT NOT NULL DEFAULT 'friendly'
        CHECK (tone IN ('professional', 'friendly', 'sales', 'empathetic')),
    schedule TEXT NOT NULL DEFAULT '24/7',
    use_cases JSONB NOT NULL DEFAULT '[]'::jsonb,
    system_prompt TEXT NOT NULL,
    fallback_message TEXT NOT NULL DEFAULT 'Disculpa, no entendí tu mensaje. ¿Podrías reformularlo?',
    error_message TEXT NOT NULL DEFAULT 'Lo siento, estoy teniendo problemas técnicos. Intenta de nuevo en unos minutos.',
    knowledge JSONB NOT NULL DEFAULT '[]'::jsonb,
    paused BOOLEAN NOT NULL DEFAULT false,
    onboarding_completed BOOLEAN NOT NULL DEFAULT false,
    max_messages_per_hour INTEGER NOT NULL DEFAULT 200,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Credenciales de proveedor (cifradas AES-256-GCM) ───────
CREATE TABLE IF NOT EXISTS provider_credentials (
    tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('whapi', 'meta', 'twilio', 'evolution')),
    credentials_encrypted TEXT NOT NULL,
    phone_number TEXT,
    webhook_secret TEXT,  -- shared secret para validar origen (query ?s=..., HMAC, etc.)
    webhook_verified BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_provider_phone ON provider_credentials(phone_number);

-- ── Conversaciones y mensajes ──────────────────────────────
CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    phone TEXT NOT NULL,
    customer_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(tenant_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_conv_tenant_phone ON conversations(tenant_id, phone);
CREATE INDEX IF NOT EXISTS idx_conv_last_msg ON conversations(tenant_id, last_message_at DESC);

CREATE TABLE IF NOT EXISTS messages (
    id BIGSERIAL PRIMARY KEY,
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    mensaje_id TEXT,   -- id del proveedor (para auditoría; dedupe vive en processed_messages)
    tokens_in INTEGER DEFAULT 0,
    tokens_out INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_msg_conversation ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_msg_tenant ON messages(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_mensaje_id ON messages(tenant_id, mensaje_id) WHERE mensaje_id IS NOT NULL;

-- ── Deduplicación de mensajes entrantes ────────────────────
-- Un mismo proveedor puede reintentar el webhook. Esta tabla garantiza
-- que cada mensaje_id se procesa una sola vez por tenant.
CREATE TABLE IF NOT EXISTS processed_messages (
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    mensaje_id TEXT NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, mensaje_id)
);
CREATE INDEX IF NOT EXISTS idx_processed_at ON processed_messages(processed_at);

-- ── Settings globales (solo super admin) ───────────────────
CREATE TABLE IF NOT EXISTS platform_settings (
    key TEXT PRIMARY KEY,
    value_encrypted TEXT NOT NULL DEFAULT '',
    description TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by UUID REFERENCES users(id)
);

-- ── Audit log ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY,
    tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    entity TEXT,
    entity_id TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_log(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id, created_at DESC);

-- ═══════════════════════════════════════════════════════════
-- Migración 003: mesero digital (fiscal + orders + recibos)
-- ═══════════════════════════════════════════════════════════

-- ── Configuración fiscal por tenant (Verifactu, certificado) ──────
CREATE TABLE IF NOT EXISTS tenant_fiscal_config (
    tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    verifactu_enabled BOOLEAN NOT NULL DEFAULT false,
    verifactu_environment TEXT NOT NULL DEFAULT 'sandbox'
        CHECK (verifactu_environment IN ('sandbox', 'production')),
    certificate_encrypted TEXT,
    certificate_password_encrypted TEXT,
    certificate_filename TEXT,
    certificate_uploaded_at TIMESTAMPTZ,
    certificate_expires_at TIMESTAMPTZ,
    invoice_series TEXT NOT NULL DEFAULT 'A',
    invoice_counter BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Pedidos ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    customer_phone TEXT,
    customer_name TEXT,
    table_number TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'awaiting_payment', 'paid', 'refunded', 'canceled')),
    currency TEXT NOT NULL DEFAULT 'EUR',
    subtotal_cents INTEGER NOT NULL DEFAULT 0,
    vat_cents INTEGER NOT NULL DEFAULT 0,
    total_cents INTEGER NOT NULL DEFAULT 0,
    stripe_payment_link_url TEXT,
    stripe_payment_intent_id TEXT UNIQUE,
    stripe_checkout_session_id TEXT UNIQUE,
    notes TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    paid_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_tenant_status ON orders(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(tenant_id, customer_phone) WHERE customer_phone IS NOT NULL;

-- ── Líneas del pedido ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
    vat_rate NUMERIC(5,2) NOT NULL DEFAULT 10.00,
    line_total_cents INTEGER NOT NULL,
    notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_tenant ON order_items(tenant_id);

-- ── Recibos (uno por pedido pagado) ───────────────────────────────
CREATE TABLE IF NOT EXISTS receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID UNIQUE NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    invoice_series TEXT NOT NULL,
    invoice_number BIGINT NOT NULL,
    verifactu_status TEXT NOT NULL DEFAULT 'skipped'
        CHECK (verifactu_status IN ('skipped', 'pending', 'submitted', 'accepted', 'rejected', 'error')),
    verifactu_submitted_at TIMESTAMPTZ,
    verifactu_response JSONB,
    verifactu_qr_data TEXT,
    verifactu_hash TEXT,
    pdf_url TEXT,
    sent_email TEXT,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, invoice_series, invoice_number)
);

CREATE INDEX IF NOT EXISTS idx_receipts_tenant ON receipts(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_receipts_verifactu_status ON receipts(verifactu_status) WHERE verifactu_status IN ('pending', 'error');
