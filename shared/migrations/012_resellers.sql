-- shared/migrations/012_resellers.sql
-- 2026-04-18 · Reseller program v1 (Stripe Connect only, no white-label)
-- 5 tablas nuevas + 1 columna en tenants.
-- Retención 6 años legal (Cco art. 30) enforceada por trigger anti-hard-delete.

BEGIN;

-- ── 1. resellers ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS resellers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
    slug TEXT UNIQUE NOT NULL
        CONSTRAINT resellers_slug_format
        CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])?$'),
    brand_name TEXT NOT NULL
        CONSTRAINT resellers_brand_name_length CHECK (char_length(brand_name) BETWEEN 2 AND 60),
    commission_rate NUMERIC(5,4) NOT NULL DEFAULT 0.2500
        CONSTRAINT resellers_commission_rate_range
        CHECK (commission_rate >= 0 AND commission_rate <= 0.5),
    status TEXT NOT NULL DEFAULT 'pending'
        CONSTRAINT resellers_status_check
        CHECK (status IN ('pending', 'active', 'paused', 'terminated')),
    stripe_connect_account_id TEXT UNIQUE,
    stripe_connect_status TEXT NOT NULL DEFAULT 'pending'
        CONSTRAINT resellers_connect_status_check
        CHECK (stripe_connect_status IN ('pending', 'active', 'restricted', 'deauthorized')),
    stripe_connect_payouts_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    stripe_connect_charges_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    country_code CHAR(2) NOT NULL
        CONSTRAINT resellers_country_iso CHECK (country_code ~ '^[A-Z]{2}$'),
    tax_strategy TEXT NOT NULL DEFAULT 'fallback'
        CONSTRAINT resellers_tax_strategy_check
        CHECK (tax_strategy IN ('es', 'eu-vat', 'fallback')),
    payout_currency CHAR(3) NOT NULL DEFAULT 'EUR'
        CONSTRAINT resellers_payout_currency_iso CHECK (payout_currency ~ '^[A-Z]{3}$'),
    legal_name TEXT CONSTRAINT resellers_legal_name_length CHECK (legal_name IS NULL OR char_length(legal_name) <= 200),
    tax_id TEXT CONSTRAINT resellers_tax_id_length CHECK (tax_id IS NULL OR char_length(tax_id) <= 40),
    tax_id_type TEXT CONSTRAINT resellers_tax_id_type_check
        CHECK (tax_id_type IS NULL OR tax_id_type IN ('nif_es', 'vat_eu', 'ein_us', 'other')),
    fiscal_sub_profile TEXT CONSTRAINT resellers_fiscal_sub_check
        CHECK (fiscal_sub_profile IS NULL OR fiscal_sub_profile IN ('autonomo_es', 'sl_es', 'autonomo_new_es')),
    iae_registered BOOLEAN NOT NULL DEFAULT FALSE,
    billing_address JSONB,
    commission_debt_cents INTEGER NOT NULL DEFAULT 0,
    self_billing_consented_at TIMESTAMPTZ,
    self_billing_agreement_version TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT resellers_es_requires_iae_and_profile CHECK (
        country_code != 'ES' OR (iae_registered = TRUE AND fiscal_sub_profile IS NOT NULL)
    ),
    CONSTRAINT resellers_active_requires_connect CHECK (
        status != 'active' OR stripe_connect_account_id IS NOT NULL
    )
);

-- ── 2. tenants.reseller_id ────────────────────────────────────
ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS reseller_id UUID
        REFERENCES resellers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tenants_reseller
    ON tenants(reseller_id) WHERE reseller_id IS NOT NULL;

-- ── 3. ref_touches (ITP dual-write) ───────────────────────────
CREATE TABLE IF NOT EXISTS ref_touches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reseller_id UUID NOT NULL REFERENCES resellers(id) ON DELETE RESTRICT,
    anon_id TEXT NOT NULL,
    ip_hash TEXT NOT NULL,
    user_agent TEXT CONSTRAINT ref_touches_ua_length CHECK (user_agent IS NULL OR char_length(user_agent) <= 500),
    utm_source TEXT CONSTRAINT ref_touches_utm_source_length CHECK (utm_source IS NULL OR char_length(utm_source) <= 100),
    utm_medium TEXT CONSTRAINT ref_touches_utm_medium_length CHECK (utm_medium IS NULL OR char_length(utm_medium) <= 100),
    utm_campaign TEXT CONSTRAINT ref_touches_utm_campaign_length CHECK (utm_campaign IS NULL OR char_length(utm_campaign) <= 100),
    utm_term TEXT CONSTRAINT ref_touches_utm_term_length CHECK (utm_term IS NULL OR char_length(utm_term) <= 100),
    utm_content TEXT CONSTRAINT ref_touches_utm_content_length CHECK (utm_content IS NULL OR char_length(utm_content) <= 200),
    referer TEXT CONSTRAINT ref_touches_referer_length CHECK (referer IS NULL OR char_length(referer) <= 500),
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (anon_id, reseller_id)
);

CREATE INDEX IF NOT EXISTS idx_ref_touches_anon
    ON ref_touches(anon_id, first_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_ref_touches_reseller
    ON ref_touches(reseller_id, first_seen_at DESC);

-- ── 4. reseller_payouts ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS reseller_payouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reseller_id UUID NOT NULL REFERENCES resellers(id) ON DELETE RESTRICT,
    period_month DATE NOT NULL
        CONSTRAINT rp_period_first_of_month CHECK (EXTRACT(DAY FROM period_month) = 1),
    source_currency CHAR(3) NOT NULL DEFAULT 'EUR',
    source_total_cents INTEGER NOT NULL
        CONSTRAINT rp_source_nonneg CHECK (source_total_cents >= 0),
    payout_currency CHAR(3) NOT NULL,
    fx_rate NUMERIC(18,8),
    fx_source TEXT CONSTRAINT rp_fx_source_check
        CHECK (fx_source IS NULL OR fx_source IN ('ecb_daily_preview', 'stripe_balance_transaction')),
    payout_total_cents INTEGER,
    tax_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
    invoice_pdf_url TEXT,
    invoice_series TEXT,
    invoice_number INTEGER,
    status TEXT NOT NULL DEFAULT 'draft'
        CONSTRAINT rp_status_check
        CHECK (status IN ('draft', 'ready', 'sent', 'paid', 'failed', 'canceled')),
    requires_high_value_approval BOOLEAN NOT NULL DEFAULT FALSE,
    approved_by_user_id UUID REFERENCES users(id),
    approved_at TIMESTAMPTZ,
    stripe_transfer_id TEXT UNIQUE,
    stripe_payout_id TEXT UNIQUE,
    failure_code TEXT,
    failure_message TEXT,
    parent_payout_id UUID REFERENCES reseller_payouts(id) ON DELETE SET NULL,
    paid_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (reseller_id, period_month, payout_currency)
);

-- ── 5. reseller_commissions ───────────────────────────────────
CREATE TABLE IF NOT EXISTS reseller_commissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reseller_id UUID NOT NULL REFERENCES resellers(id) ON DELETE RESTRICT,
    tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
    stripe_invoice_id TEXT UNIQUE NOT NULL,
    stripe_charge_id TEXT,
    stripe_customer_id TEXT NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'EUR'
        CONSTRAINT rc_currency_iso CHECK (currency ~ '^[A-Z]{3}$'),
    gross_amount_cents INTEGER NOT NULL
        CONSTRAINT rc_gross_nonneg CHECK (gross_amount_cents >= 0),
    base_amount_cents INTEGER NOT NULL
        CONSTRAINT rc_base_nonneg CHECK (base_amount_cents >= 0),
    commission_rate_snapshot NUMERIC(5,4) NOT NULL
        CONSTRAINT rc_rate_range CHECK (commission_rate_snapshot >= 0 AND commission_rate_snapshot <= 0.5),
    commission_amount_cents INTEGER NOT NULL
        CONSTRAINT rc_commission_nonneg CHECK (commission_amount_cents >= 0),
    period_month DATE NOT NULL
        CONSTRAINT rc_period_first_of_month CHECK (EXTRACT(DAY FROM period_month) = 1),
    invoice_paid_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CONSTRAINT rc_status_check
        CHECK (status IN ('pending', 'payable', 'paid', 'reversed', 'disputed')),
    payout_id UUID REFERENCES reseller_payouts(id) ON DELETE SET NULL,
    tenant_churned_at TIMESTAMPTZ,
    refunded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 6. reseller_self_billing_consents ─────────────────────────
CREATE TABLE IF NOT EXISTS reseller_self_billing_consents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reseller_id UUID NOT NULL REFERENCES resellers(id) ON DELETE RESTRICT,
    agreement_version TEXT NOT NULL,
    consented_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    signature_hash TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_sbc_reseller
    ON reseller_self_billing_consents(reseller_id, consented_at DESC);

-- ── Indexes adicionales ───────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_reseller_commissions_payable
    ON reseller_commissions(reseller_id, period_month)
    WHERE status = 'payable' AND payout_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_reseller_commissions_reseller_period
    ON reseller_commissions(reseller_id, period_month, invoice_paid_at DESC);

CREATE INDEX IF NOT EXISTS idx_reseller_commissions_tenant
    ON reseller_commissions(tenant_id, invoice_paid_at DESC)
    WHERE tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reseller_commissions_payout
    ON reseller_commissions(payout_id) WHERE payout_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reseller_payouts_pending
    ON reseller_payouts(period_month)
    WHERE status IN ('draft', 'ready', 'sent');

CREATE INDEX IF NOT EXISTS idx_reseller_payouts_reseller_period
    ON reseller_payouts(reseller_id, period_month DESC);

-- ── updated_at triggers ───────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_resellers_updated_at ON resellers;
CREATE TRIGGER trg_resellers_updated_at BEFORE UPDATE ON resellers
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_reseller_commissions_updated_at ON reseller_commissions;
CREATE TRIGGER trg_reseller_commissions_updated_at BEFORE UPDATE ON reseller_commissions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_reseller_payouts_updated_at ON reseller_payouts;
CREATE TRIGGER trg_reseller_payouts_updated_at BEFORE UPDATE ON reseller_payouts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Hard-delete prohibition trigger (6-year retention legal) ──
CREATE OR REPLACE FUNCTION prevent_hard_delete() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Hard delete not allowed on %. Use soft-delete via status column (retention 6 years per Codigo de Comercio art. 30).', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_resellers_no_delete ON resellers;
CREATE TRIGGER trg_resellers_no_delete BEFORE DELETE ON resellers
    FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

DROP TRIGGER IF EXISTS trg_reseller_commissions_no_delete ON reseller_commissions;
CREATE TRIGGER trg_reseller_commissions_no_delete BEFORE DELETE ON reseller_commissions
    FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

DROP TRIGGER IF EXISTS trg_reseller_payouts_no_delete ON reseller_payouts;
CREATE TRIGGER trg_reseller_payouts_no_delete BEFORE DELETE ON reseller_payouts
    FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();

-- ── Audit ─────────────────────────────────────────────────────
INSERT INTO audit_log (action, entity, metadata)
VALUES ('migration.applied', 'resellers',
        jsonb_build_object('version', '012', 'applied_at', now(),
                           'scope', 'v1 stripe-connect only, no whitelabel'));

COMMIT;
