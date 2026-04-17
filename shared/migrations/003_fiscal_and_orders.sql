-- 003_fiscal_and_orders.sql
-- Mesero digital: datos fiscales por tenant + Verifactu toggle + pedidos + recibos.
--
-- Verifactu queda INSTALADO pero OFF por defecto. Cada tenant decide activarlo
-- y sube su propio certificado digital (la firma es responsabilidad suya).

-- ── 1. Datos fiscales + branding en tenants ───────────────────────
ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS legal_name TEXT,
    ADD COLUMN IF NOT EXISTS tax_id TEXT,                -- NIF/CIF
    ADD COLUMN IF NOT EXISTS billing_address TEXT,
    ADD COLUMN IF NOT EXISTS billing_postal_code TEXT,
    ADD COLUMN IF NOT EXISTS billing_city TEXT,
    ADD COLUMN IF NOT EXISTS billing_country TEXT NOT NULL DEFAULT 'ES',
    ADD COLUMN IF NOT EXISTS brand_color TEXT NOT NULL DEFAULT '#7c3aed',
    ADD COLUMN IF NOT EXISTS brand_logo_url TEXT,
    ADD COLUMN IF NOT EXISTS default_vat_rate NUMERIC(5,2) NOT NULL DEFAULT 10.00;
    -- España: hostelería 10% estándar, bebidas alcohólicas 21%, cada línea lo override.

-- ── 2. Configuración fiscal por tenant (Verifactu, certificado) ───
CREATE TABLE IF NOT EXISTS tenant_fiscal_config (
    tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    verifactu_enabled BOOLEAN NOT NULL DEFAULT false,
    verifactu_environment TEXT NOT NULL DEFAULT 'sandbox'
        CHECK (verifactu_environment IN ('sandbox', 'production')),
    -- Certificado digital del tenant en formato P12/PFX. Cifrado AES-256-GCM
    -- con la ENCRYPTION_KEY global. Solo el runtime/web lo descifra en memoria
    -- cuando va a firmar un recibo. NUNCA se logea ni se devuelve al cliente.
    certificate_encrypted TEXT,
    certificate_password_encrypted TEXT,
    certificate_filename TEXT,              -- nombre original (solo display)
    certificate_uploaded_at TIMESTAMPTZ,
    certificate_expires_at TIMESTAMPTZ,     -- parsed del cert para avisar renovación
    -- Serie / contador de facturación para numeración secuencial (Verifactu exige).
    invoice_series TEXT NOT NULL DEFAULT 'A',
    invoice_counter BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 3. Pedidos (orders) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    -- Identificadores del comensal (WhatsApp + mesa). customer_phone puede ser null
    -- si el pedido llega por otro canal (QR, panel interno) en el futuro.
    customer_phone TEXT,
    customer_name TEXT,
    table_number TEXT,
    -- Estado del ciclo de vida.
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'awaiting_payment', 'paid', 'refunded', 'canceled')),
    -- Moneda y totales (céntimos para evitar float).
    currency TEXT NOT NULL DEFAULT 'EUR',
    subtotal_cents INTEGER NOT NULL DEFAULT 0,    -- base imponible
    vat_cents INTEGER NOT NULL DEFAULT 0,          -- total IVA
    total_cents INTEGER NOT NULL DEFAULT 0,        -- subtotal + vat
    -- Stripe: se rellena cuando se crea el Payment Link / PaymentIntent.
    stripe_payment_link_url TEXT,
    stripe_payment_intent_id TEXT UNIQUE,
    stripe_checkout_session_id TEXT UNIQUE,
    -- Notas y metadatos.
    notes TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    paid_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_tenant_status ON orders(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_phone ON orders(tenant_id, customer_phone) WHERE customer_phone IS NOT NULL;

-- ── 4. Líneas del pedido ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
    vat_rate NUMERIC(5,2) NOT NULL DEFAULT 10.00,
    line_total_cents INTEGER NOT NULL,  -- quantity * unit_price (sin IVA)
    notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_tenant ON order_items(tenant_id);

-- ── 5. Recibos (uno por pedido pagado) ────────────────────────────
CREATE TABLE IF NOT EXISTS receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID UNIQUE NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    -- Numeración fiscal secuencial (Serie/Número) — requerida por Verifactu.
    invoice_series TEXT NOT NULL,
    invoice_number BIGINT NOT NULL,
    -- Estado Verifactu.
    verifactu_status TEXT NOT NULL DEFAULT 'skipped'
        CHECK (verifactu_status IN ('skipped', 'pending', 'submitted', 'accepted', 'rejected', 'error')),
    verifactu_submitted_at TIMESTAMPTZ,
    verifactu_response JSONB,               -- respuesta cruda AEAT (auditoría)
    verifactu_qr_data TEXT,                 -- contenido del QR (URL con hash)
    verifactu_hash TEXT,                    -- hash de la factura firmada
    -- Delivery al comensal.
    pdf_url TEXT,
    sent_email TEXT,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, invoice_series, invoice_number)
);

CREATE INDEX IF NOT EXISTS idx_receipts_tenant ON receipts(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_receipts_verifactu_status ON receipts(verifactu_status) WHERE verifactu_status IN ('pending', 'error');
