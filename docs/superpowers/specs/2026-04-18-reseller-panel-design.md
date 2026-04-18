# Ordy Chat — Reseller Panel Design (v2)

**Fecha:** 2026-04-18
**Versión:** v2 (post audit-architect)
**Changelog v1→v2:** al final del documento
**Estado:** Revisado tras audit de 5 agentes. Scope reducido. Fixes críticos aplicados. Pendiente re-audit quirúrgico.
**Target:** Plug-and-play implementable en Ordy Chat sin romper código existente.

---

## 0. Executive summary

Programa de resellers **global** en Ordy Chat. Resellers ganan 25% recurrente mensual de cada suscripción atribuida. Solo-lectura: ven sus tenants, comisiones y payouts. Mario (super admin) ve todo y gestiona. Construido dentro del repo (`~/Projects/whatsapp-agentkit/web/`) con ediciones quirúrgicas.

**v1 ship (este spec):** Stripe Connect como único rail de pago global (46 países). Atribución por referral link con dual-write contra ITP. Tax strategies pluggable (`es`, `eu-vat`, `fallback`). Panel read-only. Sin marca blanca visual.

**Diferido a v2 (post-launch):** Mode A SEPA, white-label subdomain con branding custom, plugins fiscales adicionales (US 1099-NEC, UK IR35).

**Principios rectores:**
1. No tocar el onboarding del tenant existente (atribución vía cookie + `ref_touches` dual-write server-side; hook en `provision.ts` para leer la cookie al crear tenant).
2. Extender el webhook de Stripe, no reescribirlo. Todas las mutaciones de commission envueltas en `db.transaction()`.
3. Widening aditivo del rol `reseller` en Auth.js sin romper `super_admin|tenant_admin`.
4. Arquitectura pluggable de estrategias fiscales por país (v1: `es`, `eu-vat`, `fallback`).
5. Payouts solo vía Stripe Connect. Fuera de los 46 países soportados: onboarding bloqueado.
6. Moneda plataforma: EUR. Reseller recibe en su moneda local vía FX automática de Stripe Connect (leída de `balance_transaction.exchange_rate`).

**Número de archivos:** 31 nuevos + 8 tocados quirúrgicamente.

---

## 1. Goals / Non-goals

### Goals (v1)
- Super admin puede crear, pausar, terminar resellers y ver performance agregada (MRR, tenants activos, comisiones pendientes/pagadas).
- Resellers ven sus tenants atribuidos (read-only), comisiones devengadas y payouts recibidos.
- Atribución robusta vía `?ref=slug` + cookie `ordy_ref` 90d + `ref_touches` server-side 30d (resistente a ITP iOS).
- Motor de comisiones 25% recurrente integrado con el webhook Stripe existente (wrapped en `db.transaction()` para prevenir race conditions).
- Motor de payouts mensual vía Stripe Connect (46 países globales).
- Arquitectura pluggable fiscal: 3 estrategias en v1 (`es`, `eu-vat`, `fallback`).
- Onboarding bloquea países fuera de Stripe Connect + bloquea particulares ES sin IAE.
- Two-person approval (Mario + 2FA fresh) para batches de payout `>=5000` EUR.
- Hard-delete prohibido en DB trigger para `resellers`, `reseller_commissions`, `reseller_payouts` (retención 6 años Código de Comercio art. 30).

### Non-goals (v1) — diferidos
- Mode A SEPA (manual payout con XML pain.001 + CSV export). **Rationale:** Stripe Connect cubre los 46 países y simplifica fiscal + operativa. SEPA sin Connect es aditivo cuando tengamos demanda específica de resellers que rechacen Connect.
- **White-label subdomain con branding custom** (logo, color, nombre propio). **Rationale:** elimina 6 vulnerabilidades de seguridad (XSS, CSS injection, subdomain takeover, logo polyglot) y dependencia de infra DNS wildcard. Panel reseller es interno, branding Ordy es aceptable en v1.
- Tiers múltiples de reseller (todos 25% en v1; rate editable caso-a-caso por super admin).
- Sub-resellers, crypto/PayPal/Wise, estrategias fiscales más allá de `es`+`eu-vat`+`fallback`.
- Mobile-first para reseller (target: admin desktop).
- Acceso del reseller a PII del tenant (email, phone, address, agent prompts, provider credentials, message content, stripe customer IDs).

---

## 2. Arquitectura alto nivel

```
                     ┌─────────────────────────────────────┐
                     │  Ordy Chat (web/, Next.js 15)       │
                     │                                     │
┌─────────┐   ?ref=  │  middleware.ts                      │
│ Reseller│─────────▶│  ├─ rate limit (existing)           │
│  link   │          │  ├─ auth (existing)                 │
└─────────┘          │  └─ ref capture (NEW aditivo)       │
                     │     set cookie ordy_ref (consent)   │
                     │                                     │
                     │  client beacon → /api/ref/touch     │
                     │  └─ INSERT ref_touches (dual-write) │
                     │                                     │
┌─────────┐ onboard  │  /signup → /onboarding (unchanged)  │
│ Cliente │─────────▶│  provision.ts hook (NEW 3 líneas):  │
└─────────┘          │  - read cookie + ref_touches fallback│
                     │  - resolve reseller_id within tx    │
                     │  - write tenants.reseller_id        │
                     │                                     │
                     │  Stripe webhook (extended)          │
                     │  all cases wrapped in db.transaction│
                     │  ├─ invoice.paid → commission       │
                     │  ├─ charge.refunded → reversed      │
                     │  ├─ payout.paid (Connect) → done    │
                     │  ├─ payout.failed (Connect) → retry │
                     │  └─ account.updated → KYC status    │
                     │                                     │
                     │  Cron diario: pending→payable 30d   │
                     │  Cron mensual día 5: build payouts  │
                     │  Mario review + Run transfer batch  │
                     │                                     │
                     │  /admin/resellers/*    (super_admin)│
                     │  /reseller/*           (reseller    │
                     │                         read-only,  │
                     │                         strict scope)│
                     └─────────────────────────────────────┘
                               │                    │
                               ▼                    ▼
                     ┌────────────────┐   ┌──────────────────┐
                     │ Neon Postgres  │   │ Stripe Connect   │
                     │ migration 012  │   │ platform + exp   │
                     │ +6 tablas +col │   │ accounts 46 ctry │
                     └────────────────┘   └──────────────────┘
```

---

## 3. Data model

### 3.1 Migración — `shared/migrations/012_resellers.sql`

**Nota de numeración:** 010 y 011 tomadas por `validator` + `validator_ui`. Esta migración es **012**.

```sql
-- shared/migrations/012_resellers.sql
-- 2026-04-18 · Reseller program v1 (Stripe Connect only, no white-label)
-- 4 tablas nuevas + 1 columna en tenants.
-- Retención 6 años legal (Cco art. 30) enforceada por trigger anti-hard-delete.

BEGIN;

-- ── 1. resellers ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS resellers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
    slug TEXT UNIQUE NOT NULL
        CONSTRAINT resellers_slug_format
        CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])?$'),
    -- Nombre para mostrar en panel reseller (NO whitelabel, solo UI interna)
    brand_name TEXT NOT NULL
        CONSTRAINT resellers_brand_name_length CHECK (char_length(brand_name) BETWEEN 2 AND 60),
    commission_rate NUMERIC(5,4) NOT NULL DEFAULT 0.2500
        CONSTRAINT resellers_commission_rate_range
        CHECK (commission_rate >= 0 AND commission_rate <= 0.5),
    status TEXT NOT NULL DEFAULT 'pending'
        CONSTRAINT resellers_status_check
        CHECK (status IN ('pending', 'active', 'paused', 'terminated')),
    -- Stripe Connect (único rail v1)
    stripe_connect_account_id TEXT UNIQUE,
    stripe_connect_status TEXT NOT NULL DEFAULT 'pending'
        CONSTRAINT resellers_connect_status_check
        CHECK (stripe_connect_status IN ('pending', 'active', 'restricted', 'deauthorized')),
    stripe_connect_payouts_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    stripe_connect_charges_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    -- Internacional
    country_code CHAR(2) NOT NULL
        CONSTRAINT resellers_country_iso CHECK (country_code ~ '^[A-Z]{2}$'),
    tax_strategy TEXT NOT NULL DEFAULT 'fallback'
        CONSTRAINT resellers_tax_strategy_check
        CHECK (tax_strategy IN ('es', 'eu-vat', 'fallback')),
    payout_currency CHAR(3) NOT NULL DEFAULT 'EUR'
        CONSTRAINT resellers_payout_currency_iso CHECK (payout_currency ~ '^[A-Z]{3}$'),
    -- Fiscal
    legal_name TEXT CONSTRAINT resellers_legal_name_length CHECK (legal_name IS NULL OR char_length(legal_name) <= 200),
    tax_id TEXT CONSTRAINT resellers_tax_id_length CHECK (tax_id IS NULL OR char_length(tax_id) <= 40),
    tax_id_type TEXT CONSTRAINT resellers_tax_id_type_check
        CHECK (tax_id_type IS NULL OR tax_id_type IN ('nif_es', 'vat_eu', 'ein_us', 'other')),
    fiscal_sub_profile TEXT CONSTRAINT resellers_fiscal_sub_check
        CHECK (fiscal_sub_profile IS NULL OR fiscal_sub_profile IN ('autonomo_es', 'sl_es', 'autonomo_new_es')),
    iae_registered BOOLEAN NOT NULL DEFAULT FALSE,  -- Gate: ES country_code must have TRUE
    billing_address JSONB,
    -- Estado financiero
    commission_debt_cents INTEGER NOT NULL DEFAULT 0,  -- carry-over negativo por refunds cross-period
    -- Self-billing consent (RD 1619/2012 art. 5.2)
    self_billing_consented_at TIMESTAMPTZ,
    self_billing_agreement_version TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Integrity: si ES, debe tener IAE + fiscal_sub_profile
    CONSTRAINT resellers_es_requires_iae_and_profile CHECK (
        country_code != 'ES' OR (iae_registered = TRUE AND fiscal_sub_profile IS NOT NULL)
    ),
    -- Integrity: si status='active', debe tener Connect account
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
    anon_id TEXT NOT NULL,  -- sha256(ip + ua + date_bucket)
    ip_hash TEXT NOT NULL,
    user_agent TEXT CONSTRAINT ref_touches_ua_length CHECK (char_length(user_agent) <= 500),
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

-- ── 4. reseller_commissions ───────────────────────────────────
CREATE TABLE IF NOT EXISTS reseller_commissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reseller_id UUID NOT NULL REFERENCES resellers(id) ON DELETE RESTRICT,
    tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
    stripe_invoice_id TEXT UNIQUE NOT NULL,
    stripe_charge_id TEXT,
    stripe_customer_id TEXT NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'EUR'
        CONSTRAINT rc_currency_iso CHECK (currency ~ '^[A-Z]{3}$'),
    -- Gross = amount_paid (lo que Stripe recibió del cliente)
    gross_amount_cents INTEGER NOT NULL
        CONSTRAINT rc_gross_nonneg CHECK (gross_amount_cents >= 0),
    -- Base = subtotal Stripe (pre-tax) menos credits/coupons. Calculado en handler.
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
    payout_id UUID,  -- FK añadida post-creación
    tenant_churned_at TIMESTAMPTZ,
    refunded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 5. reseller_payouts ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS reseller_payouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reseller_id UUID NOT NULL REFERENCES resellers(id) ON DELETE RESTRICT,
    period_month DATE NOT NULL
        CONSTRAINT rp_period_first_of_month CHECK (EXTRACT(DAY FROM period_month) = 1),
    source_currency CHAR(3) NOT NULL DEFAULT 'EUR',
    source_total_cents INTEGER NOT NULL
        CONSTRAINT rp_source_nonneg CHECK (source_total_cents >= 0),
    -- Stripe Connect FX: se lee de balance_transaction.exchange_rate del charge destino
    -- POST-transfer. En draft/ready queda NULL y se calcula como preview desde ECB daily.
    payout_currency CHAR(3) NOT NULL,
    fx_rate NUMERIC(18,8),
    fx_source TEXT CONSTRAINT rp_fx_source_check
        CHECK (fx_source IS NULL OR fx_source IN ('ecb_daily_preview', 'stripe_balance_transaction')),
    payout_total_cents INTEGER,  -- NULL hasta que Stripe confirme
    -- Desglose fiscal en JSONB (shape por tax_strategy)
    tax_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Invoice auto-emitida (solo strategy='es')
    invoice_pdf_url TEXT,
    invoice_series TEXT,
    invoice_number INTEGER,
    status TEXT NOT NULL DEFAULT 'draft'
        CONSTRAINT rp_status_check
        CHECK (status IN ('draft', 'ready', 'sent', 'paid', 'failed', 'canceled')),
    -- Two-person approval para payouts >= 5000 EUR
    requires_high_value_approval BOOLEAN NOT NULL DEFAULT FALSE,
    approved_by_user_id UUID REFERENCES users(id),
    approved_at TIMESTAMPTZ,
    -- Stripe Connect
    stripe_transfer_id TEXT UNIQUE,  -- platform → connected account
    stripe_payout_id TEXT UNIQUE,    -- connected account → reseller bank
    failure_code TEXT,
    failure_message TEXT,
    -- Retry chain
    parent_payout_id UUID REFERENCES reseller_payouts(id) ON DELETE SET NULL,
    paid_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (reseller_id, period_month, payout_currency)
);

-- FK circular
ALTER TABLE reseller_commissions
    ADD CONSTRAINT reseller_commissions_payout_fk
    FOREIGN KEY (payout_id) REFERENCES reseller_payouts(id) ON DELETE SET NULL;

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
    RAISE EXCEPTION 'Hard delete not allowed on %. Use soft-delete via status column (retention 6 years per Código de Comercio art. 30).', TG_TABLE_NAME;
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
```

**Rollback en `012_resellers.rollback.sql`**: drop de los 3 triggers anti-delete primero (si no, no se puede dropear las tablas), luego DROP TABLE en orden inverso, luego `ALTER TABLE tenants DROP COLUMN reseller_id`.

**Aplicación en Neon:** crear branch `reseller-migration` desde `main`, aplicar vía `mcp__Neon__run_sql_transaction`, verificar EXPLAIN de queries hot (ver §3.3), después merge.

### 3.2 Drizzle schema additions — `web/lib/db/schema.ts` (append literal)

Añadir **antes** de la declaración de `tenants` (por forward-ref en `tenants.resellerId`):

```ts
// ── Resellers (migración 012) ─────────────────────────────────
export const resellers = pgTable("resellers", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().unique().references(() => users.id, { onDelete: "restrict" }),
  slug: text("slug").notNull().unique(),
  brandName: text("brand_name").notNull(),
  commissionRate: numeric("commission_rate", { precision: 5, scale: 4 }).notNull().default("0.2500"),
  status: text("status").notNull().default("pending"),
  stripeConnectAccountId: text("stripe_connect_account_id").unique(),
  stripeConnectStatus: text("stripe_connect_status").notNull().default("pending"),
  stripeConnectPayoutsEnabled: boolean("stripe_connect_payouts_enabled").notNull().default(false),
  stripeConnectChargesEnabled: boolean("stripe_connect_charges_enabled").notNull().default(false),
  countryCode: text("country_code").notNull(),
  taxStrategy: text("tax_strategy").notNull().default("fallback"),
  payoutCurrency: text("payout_currency").notNull().default("EUR"),
  legalName: text("legal_name"),
  taxId: text("tax_id"),
  taxIdType: text("tax_id_type"),
  fiscalSubProfile: text("fiscal_sub_profile"),
  iaeRegistered: boolean("iae_registered").notNull().default(false),
  billingAddress: jsonb("billing_address"),
  commissionDebtCents: integer("commission_debt_cents").notNull().default(0),
  selfBillingConsentedAt: timestamp("self_billing_consented_at", { withTimezone: true }),
  selfBillingAgreementVersion: text("self_billing_agreement_version"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const refTouches = pgTable("ref_touches", {
  id: uuid("id").primaryKey().defaultRandom(),
  resellerId: uuid("reseller_id").notNull().references(() => resellers.id, { onDelete: "restrict" }),
  anonId: text("anon_id").notNull(),
  ipHash: text("ip_hash").notNull(),
  userAgent: text("user_agent"),
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  utmTerm: text("utm_term"),
  utmContent: text("utm_content"),
  referer: text("referer"),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ uniqAnonReseller: unique().on(t.anonId, t.resellerId) }));

export const resellerPayouts = pgTable("reseller_payouts", {
  id: uuid("id").primaryKey().defaultRandom(),
  resellerId: uuid("reseller_id").notNull().references(() => resellers.id, { onDelete: "restrict" }),
  periodMonth: timestamp("period_month", { mode: "date" }).notNull(),
  sourceCurrency: text("source_currency").notNull().default("EUR"),
  sourceTotalCents: integer("source_total_cents").notNull(),
  payoutCurrency: text("payout_currency").notNull(),
  fxRate: numeric("fx_rate", { precision: 18, scale: 8 }),
  fxSource: text("fx_source"),
  payoutTotalCents: integer("payout_total_cents"),
  taxBreakdown: jsonb("tax_breakdown").notNull().default({}),
  invoicePdfUrl: text("invoice_pdf_url"),
  invoiceSeries: text("invoice_series"),
  invoiceNumber: integer("invoice_number"),
  status: text("status").notNull().default("draft"),
  requiresHighValueApproval: boolean("requires_high_value_approval").notNull().default(false),
  approvedByUserId: uuid("approved_by_user_id").references(() => users.id),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  stripeTransferId: text("stripe_transfer_id").unique(),
  stripePayoutId: text("stripe_payout_id").unique(),
  failureCode: text("failure_code"),
  failureMessage: text("failure_message"),
  parentPayoutId: uuid("parent_payout_id"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ uniqPeriod: unique().on(t.resellerId, t.periodMonth, t.payoutCurrency) }));

export const resellerCommissions = pgTable("reseller_commissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  resellerId: uuid("reseller_id").notNull().references(() => resellers.id, { onDelete: "restrict" }),
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "set null" }),
  stripeInvoiceId: text("stripe_invoice_id").unique().notNull(),
  stripeChargeId: text("stripe_charge_id"),
  stripeCustomerId: text("stripe_customer_id").notNull(),
  currency: text("currency").notNull().default("EUR"),
  grossAmountCents: integer("gross_amount_cents").notNull(),
  baseAmountCents: integer("base_amount_cents").notNull(),
  commissionRateSnapshot: numeric("commission_rate_snapshot", { precision: 5, scale: 4 }).notNull(),
  commissionAmountCents: integer("commission_amount_cents").notNull(),
  periodMonth: timestamp("period_month", { mode: "date" }).notNull(),
  invoicePaidAt: timestamp("invoice_paid_at", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("pending"),
  payoutId: uuid("payout_id").references(() => resellerPayouts.id, { onDelete: "set null" }),
  tenantChurnedAt: timestamp("tenant_churned_at", { withTimezone: true }),
  refundedAt: timestamp("refunded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const resellerSelfBillingConsents = pgTable("reseller_self_billing_consents", {
  id: uuid("id").primaryKey().defaultRandom(),
  resellerId: uuid("reseller_id").notNull().references(() => resellers.id, { onDelete: "restrict" }),
  agreementVersion: text("agreement_version").notNull(),
  consentedAt: timestamp("consented_at", { withTimezone: true }).notNull().defaultNow(),
  signatureHash: text("signature_hash").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
});

// Type exports
export type Reseller = typeof resellers.$inferSelect;
export type NewReseller = typeof resellers.$inferInsert;
export type RefTouch = typeof refTouches.$inferSelect;
export type ResellerCommission = typeof resellerCommissions.$inferSelect;
export type NewResellerCommission = typeof resellerCommissions.$inferInsert;
export type ResellerPayout = typeof resellerPayouts.$inferSelect;
export type NewResellerPayout = typeof resellerPayouts.$inferInsert;
```

**Modificación al bloque `tenants` existente** (una sola línea, antes de `createdAt`):

```ts
resellerId: uuid("reseller_id").references((): any => resellers.id, { onDelete: "set null" }),
```

### 3.3 Invariantes + hot queries

**1. Commission snapshot con transacción atómica**: todo el handler de `invoice.paid` va envuelto en `db.transaction(async tx => {...})`. La tx hace `SELECT tenants + resellers` + calcula commission + INSERT commission en el mismo snapshot de la DB. Sin `FOR UPDATE` porque `commission_rate_snapshot` se escribe de la fila leída — race window solo afecta rate FUTURO, no esta commission.

**2. Payout = SUM(commissions)**: `payout_id` column en `reseller_commissions` (no pivot table). Transacción de creación en §6.8.

**3. Currency consistency**: UNIQUE `(reseller_id, period_month, payout_currency)` lo impone.

**Hot queries + EXPLAIN esperado:**

```sql
-- Q1 Listar commissions reseller X mes M: usa idx_reseller_commissions_reseller_period
-- Q2 Agregado mensual payable: usa idx_reseller_commissions_payable (partial, pequeño)
-- Q3 Lookup reseller por slug: usa UNIQUE btree implícito
-- Q4 Resolver atribución tenant.resellerId: usa idx_tenants_reseller
```

Verificar con `mcp__Neon__explain_sql_statement` en branch antes de merge.

---

## 4. Atribución

### 4.1 Link formats

```
https://ordychat.ordysuite.com/?ref=juan
https://ordychat.ordysuite.com/?ref=juan&utm_source=instagram&utm_campaign=spring
```

### 4.2 Middleware patch — `web/middleware.ts`

Dentro del `auth(async (req) => {...})` actual, **antes** del return:

```ts
// --- BEGIN reseller attribution (NEW, additive) ---
const { pathname, searchParams } = req.nextUrl;
const ref = searchParams.get("ref");
const skipRef =
  pathname.startsWith("/admin") ||
  pathname.startsWith("/reseller") ||
  pathname.startsWith("/api");

// Regex SINCRONIZADO con CHECK de DB (no más laxo)
const SLUG_REGEX = /^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])?$/;

if (ref && !skipRef && SLUG_REGEX.test(ref) && !req.cookies.get("ordy_ref")) {
  const hasConsent = req.cookies.get("ordy_consent_attribution")?.value === "1";
  if (hasConsent) {
    const res = NextResponse.next();
    res.cookies.set("ordy_ref", ref, {
      maxAge: 60 * 60 * 24 * 90,
      sameSite: "lax",
      path: "/",
      httpOnly: false,  // JS lee para beacon a /api/ref/touch
      secure: process.env.NODE_ENV === "production",
    });
    return res;
  }
}
// --- END reseller attribution ---
```

**Matcher update:** añadir `"/"` al matcher actual.

### 4.3 Cookie consent banner

Componente nuevo `web/components/cookie-consent.tsx`. Comportamiento:
- Se muestra si no existe cookie `ordy_consent_v1` (cookie separada del consent de atribución)
- Dos botones **equidistantes y del mismo tamaño visual** (AEPD art. 22.2 Guía nov-2023): "Aceptar todas" + "Rechazar todas"
- Tercer link menos prominente: "Personalizar" → modal con categorías individuales (`essential`, `attribution`)
- Al rechazar: set `ordy_consent_v1=rejected`, **no** set `ordy_consent_attribution`
- Al aceptar: set `ordy_consent_v1=accepted` + `ordy_consent_attribution=1`
- Al personalizar: set según elección del usuario
- Todas las cookies: 180 días, `SameSite=Lax`, path=`/`

### 4.4 API `/api/ref/touch` (POST) — `web/app/api/ref/touch/route.ts`

Body (validado con Zod):
```ts
z.object({
  ref: z.string().regex(SLUG_REGEX).max(40),
  utm_source: z.string().max(100).nullable().optional(),
  utm_medium: z.string().max(100).nullable().optional(),
  utm_campaign: z.string().max(100).nullable().optional(),
  utm_term: z.string().max(100).nullable().optional(),
  utm_content: z.string().max(200).nullable().optional(),
  referer: z.string().max(500).nullable().optional(),
})
```

Validaciones server-side (en orden):
1. Zod parse → 400 si falla
2. `Sec-Fetch-Dest: document` check → 400 si no (anti cookie-stuffing)
3. UA filter (googlebot, ahrefsbot, semrushbot, bingbot, slurp, yandexbot) → 204 no-op
4. `limitByIp` 100/h (existente) + **`limitByResellerSlug(ref)` 50/h (helper nuevo)**
5. Resolver reseller: `SELECT id, user_id, status FROM resellers WHERE slug=$1 AND status='active' LIMIT 1` → 404 si no existe o no active
6. Self-referral check: si hay sesión activa Y `users.email` del sesión = email del `reseller.user.email` → log `reseller.ref.suspicious_self` en audit_log (no bloquea flow pero flaggea)
7. Calcular `anon_id = sha256(ip + ua + YYYY-MM-DD)` (bucket diario, privacy-first)
8. INSERT `ref_touches` con `ON CONFLICT (anon_id, reseller_id) DO NOTHING` (first-touch garantizado por UNIQUE)
9. INSERT `audit_log` `action='reseller.attribution.touch'` con `{reseller_id, anon_id_prefix: first-8-chars}`
10. Return 204

### 4.5 Hook en `provision.ts` — 3 líneas surgical

El INSERT de tenants vive en `web/lib/onboarding-fast/provision.ts:116`. Añadir ANTES del INSERT:

```ts
// ── Reseller attribution (v1) ──────────────────────────────
const resellerId = await resolveResellerAttribution({
  cookieStore: await cookies(),
  ipHash: input.ipHash,  // ya se computa en el flow actual
  userAgent: input.userAgent,
  signupEmail: input.email,
  tx,  // la transacción en curso
});
// ... INSERT tenants existente + `resellerId: resellerId`
```

Helper nuevo `web/lib/reseller/attribution.ts`:

```ts
export async function resolveResellerAttribution(args: {
  cookieStore: ReadonlyRequestCookies;
  ipHash: string;
  userAgent: string | null;
  signupEmail: string;
  tx: DrizzleTx;
}): Promise<string | null> {
  // 1. Cookie first-touch
  const refCookie = args.cookieStore.get("ordy_ref")?.value;
  if (refCookie) {
    const [r] = await args.tx.select({ id: resellers.id, userId: resellers.userId })
      .from(resellers)
      .where(and(eq(resellers.slug, refCookie), eq(resellers.status, "active")))
      .limit(1);
    if (r) {
      await checkSelfReferral(args.tx, r, args.signupEmail);
      return r.id;
    }
  }
  // 2. ref_touches fallback (30d ITP safety net)
  const anonId = computeAnonId(args.ipHash, args.userAgent);
  const [touch] = await args.tx.select().from(refTouches)
    .where(and(
      eq(refTouches.anonId, anonId),
      gte(refTouches.firstSeenAt, sql`now() - interval '30 days'`),
    ))
    .orderBy(desc(refTouches.firstSeenAt))
    .limit(1);
  if (touch) {
    const [r] = await args.tx.select({ id: resellers.id, userId: resellers.userId })
      .from(resellers)
      .where(and(eq(resellers.id, touch.resellerId), eq(resellers.status, "active")))
      .limit(1);
    if (r) {
      await checkSelfReferral(args.tx, r, args.signupEmail);
      return r.id;
    }
  }
  return null;  // venta directa Ordy
}
```

`checkSelfReferral` compara email del signup con email del `users` del reseller, log en audit_log si match. **No bloquea** — solo flaggea para review manual de Mario.

### 4.6 Cron `/api/cron/commissions-mature` (30d hold)

`web/app/api/cron/commissions-mature/route.ts`, guarded por `validateCronAuth` (`web/lib/cron.ts:16`), corre **diario 03:00 UTC**:

```sql
UPDATE reseller_commissions
SET status = 'payable'
WHERE status = 'pending'
  AND invoice_paid_at <= now() - interval '30 days'
  AND refunded_at IS NULL
  AND (tenant_churned_at IS NULL OR tenant_churned_at > invoice_paid_at + interval '30 days');
```

Añadir a `web/vercel.json` (ya existe, tiene 3 crons, añadir el 4º):

```json
{ "path": "/api/cron/commissions-mature", "schedule": "0 3 * * *" },
{ "path": "/api/cron/resellers-payout-run", "schedule": "0 8 5 * *" }
```

---

## 5. Motor de comisiones (Stripe webhook)

### 5.1 Extensión a `web/app/api/stripe/webhook/route.ts`

**Solo aditivo.** 5 cases nuevos (corregidos vs v1: eventos Stripe VÁLIDOS). Todo dentro del switch existente, **cada case envuelto en `db.transaction()`**:

```ts
case "invoice.paid": {
  await db.transaction(async (tx) => {
    const inv = event.data.object as Stripe.Invoice;
    const subId = typeof inv.subscription === "string" ? inv.subscription : inv.subscription?.id;
    if (!subId) return;

    const [t] = await tx.select().from(tenants)
      .where(eq(tenants.stripeSubscriptionId, subId)).limit(1);
    if (!t?.resellerId) return;

    const [r] = await tx.select().from(resellers)
      .where(eq(resellers.id, t.resellerId)).limit(1);
    if (!r || r.status !== "active") return;

    // Base = subtotal_excluding_tax si existe (>= Stripe API 2024-06-20), else subtotal
    // (amount_paid incluye tax + fees). Coupons ya están descontados de subtotal.
    const base = inv.subtotal_excluding_tax ?? inv.subtotal ?? inv.amount_paid ?? 0;
    const gross = inv.amount_paid ?? 0;
    if (base <= 0) return;  // promo 100%, skip commission

    const rate = Number(r.commissionRate);
    const commission = Math.floor(base * rate);

    const paidAt = inv.status_transitions?.paid_at ?? inv.created;
    const period = new Date(Date.UTC(
      new Date(paidAt * 1000).getUTCFullYear(),
      new Date(paidAt * 1000).getUTCMonth(), 1));

    await tx.insert(resellerCommissions).values({
      resellerId: r.id,
      tenantId: t.id,
      stripeInvoiceId: inv.id,
      stripeChargeId: (typeof inv.charge === "string" ? inv.charge : inv.charge?.id) ?? null,
      stripeCustomerId: typeof inv.customer === "string" ? inv.customer : inv.customer!.id,
      currency: (inv.currency ?? "eur").toUpperCase(),
      grossAmountCents: gross,
      baseAmountCents: base,
      commissionRateSnapshot: r.commissionRate,
      commissionAmountCents: commission,
      periodMonth: period,
      invoicePaidAt: new Date(paidAt * 1000),
      status: "pending",
    }).onConflictDoNothing({ target: resellerCommissions.stripeInvoiceId });
  });
  break;
}

case "charge.refunded": {
  const ch = event.data.object as Stripe.Charge;
  // Marca commission como reversed. NO clawback físico si ya payable/paid.
  // Refund cross-period: el motor de payouts detecta reversed y resta del siguiente batch.
  await db.update(resellerCommissions)
    .set({ status: "reversed", refundedAt: new Date() })
    .where(eq(resellerCommissions.stripeChargeId, ch.id));
  break;
}

// Stripe Connect eventos — CORRECTOS (transfer.* NO existe a nivel top de Events)
case "payout.paid": {
  // Webhook DE LA CONNECTED ACCOUNT (llega con Stripe-Account header).
  // Se dispara cuando el banco del reseller confirma recepción.
  const po = event.data.object as Stripe.Payout;
  await db.update(resellerPayouts)
    .set({ status: "paid", paidAt: new Date(po.arrival_date * 1000) })
    .where(eq(resellerPayouts.stripePayoutId, po.id));
  break;
}

case "payout.failed": {
  const po = event.data.object as Stripe.Payout;
  await db.update(resellerPayouts)
    .set({
      status: "failed",
      failureCode: po.failure_code ?? null,
      failureMessage: po.failure_message ?? null,
    })
    .where(eq(resellerPayouts.stripePayoutId, po.id));
  // Trigger email a Mario + reseller (fuera de esta tx)
  break;
}

case "account.updated": {
  // Reseller Connect account KYC status change.
  const acct = event.data.object as Stripe.Account;
  const deauthorized = acct.requirements?.disabled_reason === "requirements.past_due" ? false : false;
  const status: string = deauthorized ? "deauthorized"
    : (acct.payouts_enabled && acct.charges_enabled) ? "active"
    : acct.requirements?.disabled_reason ? "restricted"
    : "pending";
  await db.update(resellers)
    .set({
      stripeConnectStatus: status,
      stripeConnectPayoutsEnabled: acct.payouts_enabled ?? false,
      stripeConnectChargesEnabled: acct.charges_enabled ?? false,
    })
    .where(eq(resellers.stripeConnectAccountId, acct.id));
  break;
}

case "account.application.deauthorized": {
  // Reseller desautorizó desde su Stripe. Cuenta queda inutilizable.
  const acct = event.data.object as Stripe.Account;
  await db.update(resellers)
    .set({
      stripeConnectStatus: "deauthorized",
      stripeConnectPayoutsEnabled: false,
      stripeConnectChargesEnabled: false,
      status: "paused",  // auto-pausa el reseller
    })
    .where(eq(resellers.stripeConnectAccountId, acct.id));
  break;
}
```

Idempotencia:
- `invoice.paid`: `stripeInvoiceId UNIQUE` + `onConflictDoNothing`. Más `stripe_events` dedupe ya existente (`webhook/route.ts:39-46`).
- `charge.refunded` / `payout.*` / `account.*`: update WHERE, no-op si ya aplicado.

### 5.2 Fix rol escalation via SUPER_ADMIN_EMAIL

El audit identificó vulnerabilidad: `lib/auth.ts:173-180` promueve a `super_admin` cualquier user cuyo email coincida con `SUPER_ADMIN_EMAIL`, sin check de rol actual. Un reseller que cambiase email (re-binding via magic link) escalaba.

**Fix quirúrgico a `lib/auth.ts`** (callback `signIn`):

```ts
// Solo promover a super_admin si el rol actual NO es uno ya asignado (tenant_admin o reseller)
if (user.email === process.env.SUPER_ADMIN_EMAIL) {
  const [existing] = await db.select({ role: users.role }).from(users)
    .where(eq(users.email, user.email)).limit(1);
  if (!existing || existing.role === "tenant_admin") {
    // Caso 1: first login del super admin → promover
    // Caso 2: tenant_admin con email matching → OK promover (admin caso de uso)
    // Caso 3: reseller con email matching → NO promover (seguridad)
    await db.update(users).set({ role: "super_admin" }).where(eq(users.email, user.email));
  }
  // Si ya es super_admin → no-op. Si ya es reseller → log warning + NO promover.
  if (existing?.role === "reseller") {
    await auditLog("auth.suspicious.reseller_email_matches_super_admin", { email: user.email });
  }
}
```

---

## 6. Motor de payouts (Stripe Connect únicamente)

### 6.1 Arquitectura pluggable

```
web/lib/payouts/
├── aggregate.ts          # SQL agregación mensual
├── registry.ts           # resolver strategy por reseller
├── strategies/
│   ├── types.ts          # interfaz TaxStrategy
│   ├── es.ts             # autónomo + SL + Verifactu self-billing
│   ├── eu-vat.ts         # reverse charge UE
│   └── fallback.ts       # resto del mundo
├── stripe-transfer.ts    # crear transfer + leer FX post-transfer
├── invoice.ts            # self-billing vía verifactu (solo strategy='es')
├── fx.ts                 # ECB daily preview + balance_transaction.exchange_rate reader
└── cron.ts               # orquestación mensual
```

### 6.2 Interfaz `TaxStrategy`

```ts
// web/lib/payouts/strategies/types.ts
export interface TaxBreakdown {
  source_cents: number;
  base_cents: number;
  vat_rate: number;
  vat_cents: number;
  withholding_rate: number;
  withholding_cents: number;
  transfer_cents: number;  // lo que se transfiere a la connected account (EUR)
  requires_self_billing: boolean;
  requires_vat_id_validation: boolean;
  reporting_forms: string[];
  warnings?: string[];
}

export interface TaxStrategy {
  readonly code: 'es' | 'eu-vat' | 'fallback';
  canApply(reseller: Reseller): boolean;
  calculate(reseller: Reseller, commissionSumCents: number): TaxBreakdown;
  generateInvoice?(
    reseller: Reseller,
    payout: ResellerPayout,
    breakdown: TaxBreakdown,
  ): Promise<{ pdfUrl: string; series: string; number: number }>;
}
```

### 6.3 Estrategia `es`

`country_code='ES'`, subdivide por `fiscal_sub_profile`:
- `autonomo_es`: IVA 21% repercutido + IRPF 15% retenido. Modelo 111/190/347.
- `autonomo_new_es`: IVA 21% + IRPF **7%** primeros 2 años (flag `autonomo_new_es`).
- `sl_es`: IVA 21%, IRPF 0% por defecto con **`warnings: ['sl_irpf_unverified_consult_asesor']`** (audit legal flagged). Mario confirma con asesor antes de activar el reseller.
- Canarias (detectado por `billing_address.country_province_code IN ('35','38')`): sustituye IVA 21% por IGIC 7%.

**Invoice generation** vía `web/lib/verifactu/` reutilizable. Firma esperada (a confirmar leyendo el módulo):

```ts
// Propuesta — verificar en lib/verifactu/index.ts antes de F5
await verifactuGenerateSelfBillingInvoice({
  series: `R${year}`,
  emisor: { legalName: reseller.legalName!, nif: reseller.taxId!, address: reseller.billingAddress },
  receptor: { legalName: "Mario [ORDY_LEGAL_NAME env]", nif: process.env.ORDY_NIF, address: ordyAddress },
  lineItems: [{
    concept: `Comisión venta Ordy Chat ${formatPeriod(payout.periodMonth)}`,
    base_cents: breakdown.base_cents,
    vat_rate_bps: breakdown.vat_rate * 10000,
    vat_cents: breakdown.vat_cents,
    irpf_rate_bps: breakdown.withholding_rate * 10000,
    irpf_cents: breakdown.withholding_cents,
  }],
  totalCents: breakdown.transfer_cents,
});
```

### 6.4 Estrategia `eu-vat`

VAT-ID UE válido (VIES-checked al onboarding, revalidado trimestral). Reverse charge: todos los rates = 0. `reporting_forms: ['modelo_349']`. No genera factura — reseller sube PDF propio en `/reseller/payouts/[id]` (upload validated: PDF-only, max 2MB, stored in existing blob storage).

### 6.5 Estrategia `fallback`

Rest of world (fuera ES + fuera UE VAT). Comisión base directa, Mario no retiene. `warnings: ['reseller_assumes_local_tax_compliance']`. Cláusula contractual obligatoria en Reseller Agreement (ver §12).

### 6.6 FX — corregido

v1 (incorrecto): asumía `transfer.amount_reversed` o `destination_payment` daban FX. **No lo dan.**

v2 (correcto):
- **Preview en UI** (draft/ready): `fx_rate` calculado vía ECB daily XML (`https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml`, free, no auth, cached 24h). `fx_source='ecb_daily_preview'`.
- **Post-transfer final**: el `payout_total_cents` real se lee de la **connected account** usando `stripe.balanceTransactions.retrieve(bt_id, { stripeAccount: reseller.stripeConnectAccountId })`. El `exchange_rate` del balance transaction da el FX aplicado. `fx_source='stripe_balance_transaction'`.

Mapping `country_code → payout_currency` en `web/lib/payouts/fx.ts`:

```ts
const COUNTRY_TO_CURRENCY: Record<string, string> = {
  // SEPA zone → EUR (incluye ES, FR, DE, IT, NL, PT, BE, IE, AT, FI, LU, GR, CY, SK, SI, EE, LV, LT, MT)
  ES: "EUR", FR: "EUR", DE: "EUR", IT: "EUR", NL: "EUR", PT: "EUR", BE: "EUR",
  IE: "EUR", AT: "EUR", FI: "EUR", LU: "EUR", GR: "EUR", CY: "EUR", SK: "EUR",
  SI: "EUR", EE: "EUR", LV: "EUR", LT: "EUR", MT: "EUR",
  // Otros Stripe Connect countries
  US: "USD", GB: "GBP", CA: "CAD", AU: "AUD", NZ: "NZD", JP: "JPY",
  CH: "CHF", NO: "NOK", SE: "SEK", DK: "DKK", PL: "PLN", CZ: "CZK",
  HU: "HUF", RO: "RON", BG: "BGN", HR: "HRK",
  SG: "SGD", HK: "HKD", MY: "MYR", TH: "THB", MX: "MXN", BR: "BRL",
  IN: "INR", AE: "AED",
};
```

Si country no está en el map → reject en onboarding (no soportado por Stripe Connect).

### 6.7 State machine del payout

```
     draft ──calc OK──▶ ready
       │                  │
       ▼                  ▼
   canceled           sent (Mario click "Run batch", 2-person si >=5000 EUR)
                         │
              paid ◀─────┤─────▶ failed
                         │         │
                         ▼         ▼ (regenerate new payout row)
                      (terminal)  ready (retry)
```

`paid` y `canceled` terminales. `failed → ready` solo si Mario aprueba regeneración manual.

### 6.8 Cron `/api/cron/resellers-payout-run`

Schedule en `vercel.json`: `0 8 5 * *` (día 5 del mes, 08:00 UTC ≈ 09:00-10:00 Europe/Madrid).

```
1. validateCronAuth(req)
2. periodMonth = trunc(month(now() - 1 day))
3. Para cada reseller con commissions 'payable' sin payout:
   a. db.transaction:
      - INSERT reseller_payouts status='draft' con source_total_cents
      - UPDATE reseller_commissions SET payout_id=X, status='paid'
      - Verificar RETURNING sum == source_total_cents, ROLLBACK si no
4. Para cada draft:
   - KYC GATE: si reseller.stripe_connect_status != 'active' OR !payouts_enabled → skip, email Mario
   - strategy = registry.resolve(reseller)
   - breakdown = strategy.calculate(...)
   - fx_rate preview desde ECB
   - if strategy.code === 'es': invoice = await strategy.generateInvoice(...)
   - UPDATE payout status='ready' + tax_breakdown + invoice_pdf_url + fx_rate preview
   - Si source_total_cents (EUR) >= 500000 (5000 EUR) → set requires_high_value_approval=TRUE
5. Email Mario con /admin/payouts?period=YYYY-MM
6. HALT. Mario revisa y clicks "Run batch" (ver §6.9)
```

MIN_PAYOUT_CENTS carry-forward: si total < `MIN_PAYOUT_CENTS` (env var, default 1000 = 10 EUR), commissions quedan en `payable` con `payout_id=NULL`.

### 6.9 Run batch endpoint — two-person approval

`POST /api/admin/payouts/[id]/approve` (super_admin only):
- Si `requires_high_value_approval=TRUE`: exigir **2FA fresh** (revalidación OTP < 2 minutos antes del click). Si no hay 2FA TOTP configurado, rechazar con mensaje "High-value payouts require 2FA; configure in /admin/security".
- Marca `approved_by_user_id`, `approved_at`, status `ready → sent`.
- Llama `stripe.transfers.create` a la Connect account del reseller.

### 6.10 Stripe Connect flow

**Onboarding** (`/reseller/settings`):
```
POST /api/reseller/stripe-connect/start
  → stripe.accounts.create({ type: 'express', country: reseller.countryCode,
                             capabilities: { transfers: { requested: true }} })
  → stripe.accountLinks.create({ type: 'account_onboarding', refresh_url, return_url })
  → redirect
Callback /api/reseller/stripe-connect/callback:
  → validar session.user.id === reseller.user_id (anti-hijack)
  → stripe.accounts.retrieve(acctId) → verify charges_enabled + payouts_enabled
  → UPDATE reseller.stripeConnectAccountId + status
```

**Transfer mensual** (invocado desde `/admin/payouts/[id]/approve`):
```ts
// KYC gate (duplicado del cron, defense-in-depth)
if (!reseller.stripeConnectPayoutsEnabled) throw new Error("connect_kyc_pending");

const transfer = await stripe.transfers.create({
  amount: breakdown.transfer_cents,
  currency: 'eur',
  destination: reseller.stripe_connect_account_id,
  transfer_group: `payout_${payout.id}`,
  metadata: { payout_id: payout.id, reseller_id: reseller.id },
}, { idempotencyKey: `payout_${payout.id}_attempt_${attemptN}` });

await db.update(resellerPayouts).set({ stripeTransferId: transfer.id, status: 'sent' }).where(eq(...));
```

La connected account automáticamente hace `payout` al banco del reseller (Stripe schedule). Esos `payout.paid`/`payout.failed` llegan al webhook con `Stripe-Account` header. El handler los procesa (§5.1).

### 6.11 Refund cross-period

Flujo documentado:
1. `charge.refunded` webhook → commission se marca `reversed` (cualquier status anterior).
2. Si commission tenía `payout_id` y ese payout está `paid`: **no clawback físico**. En su lugar: `resellers.commission_debt_cents += commission_amount_cents`.
3. Próximo cron mensual: `source_total_cents = SUM(payable) - commission_debt_cents`. Si resultado < 0, payout no se crea, debt rolea al mes siguiente.
4. Si el debt supera 3 meses o 500 EUR, alert a Mario para resolución manual.

---

## 7. Auth.js — widening del rol

Patch a `web/lib/auth.ts`:

```ts
// L93-94 — union en session type
role: "super_admin" | "tenant_admin" | "reseller";

// L169 — cast
session.user.role =
  (row?.role as "super_admin" | "tenant_admin" | "reseller") ?? "tenant_admin";

// L173-180 — signIn callback hardening (ver §5.2)
```

Asignación del rol `reseller` **solo** desde `/admin/resellers/new` server action en `db.transaction()`:
1. INSERT en `users` (si no existe) o resolve existing
2. UPDATE `users.role = 'reseller'` (atómico dentro de tx)
3. INSERT en `resellers`
4. INSERT en `audit_log` action='admin.reseller.created'

Si algún paso falla → ROLLBACK, state consistente.

---

## 8. Middleware — role guards + rate limits

### 8.1 Patch a `web/middleware.ts`

```ts
// Guard /reseller/* (paralelo al /admin/* existente)
if (pathname.startsWith("/reseller")) {
  if (!isAuthed) return NextResponse.redirect(new URL("/signin?from=/reseller", req.url));
  if (req.auth?.user?.role !== "reseller") {
    const dest = req.auth?.user?.role === "super_admin" ? "/admin/resellers" : "/dashboard";
    return NextResponse.redirect(new URL(dest, req.url));
  }
}
```

Matcher añade `"/reseller/:path*"` y `"/"`.

### 8.2 Rate limit helpers nuevos en `web/lib/rate-limit.ts`

```ts
// Patrón clone de limitByUserOnboarding (L63)
export async function limitByResellerSlug(slug: string) {
  return _limit(`rl:reseller_slug:${slug}`, 50, "1 h");
}
export async function limitByUserId(userId: string, bucket: string, limit: number, window: Duration) {
  return _limit(`rl:user:${userId}:${bucket}`, limit, window);
}
```

Endpoints protegidos adicionalmente (sobre el `limitByIp` 100/min global):
- `/api/admin/resellers/create` → `limitByUserId(userId, "reseller_create", 10, "1 h")`
- `/api/admin/resellers/[id]/approve` → `limitByUserId(..., "reseller_approve", 30, "1 h")`
- `/api/admin/payouts/[id]/approve` → `limitByUserId(..., "payout_approve", 60, "1 h")`
- `/api/reseller/stripe-connect/start` → `limitByUserId(..., "connect_start", 5, "1 h")`
- `/api/ref/touch` → `limitByResellerSlug(slug)` + `limitByIp`

---

## 9. IDOR scope — field allowlist explícita

### 9.1 `web/lib/reseller/scope.ts`

```ts
import { z } from "zod";

export class IDORError extends Error {}

export async function getSessionReseller(session: Session): Promise<Reseller> {
  if (session.user.role !== "reseller") throw new IDORError("forbidden_role");
  const [r] = await db.select().from(resellers)
    .where(eq(resellers.userId, session.user.id)).limit(1);
  if (!r) throw new IDORError("no_reseller_linked");
  return r;
}

// Campos VISIBLES para reseller (allowlist explícita)
export const TENANT_RESELLER_VIEW_FIELDS = {
  id: tenants.id,
  slug: tenants.slug,
  subscriptionStatus: tenants.subscriptionStatus,
  trialEndsAt: tenants.trialEndsAt,
  createdAt: tenants.createdAt,
  // Un alias "display_name" derivado del slug — NO el name real (puede ser PII)
} as const;

export async function resellerTenantsList(session: Session) {
  const reseller = await getSessionReseller(session);
  return db.select(TENANT_RESELLER_VIEW_FIELDS).from(tenants)
    .where(eq(tenants.resellerId, reseller.id));
}

export async function resellerTenantById(session: Session, tenantId: string) {
  const reseller = await getSessionReseller(session);
  const [t] = await db.select(TENANT_RESELLER_VIEW_FIELDS).from(tenants)
    .where(and(eq(tenants.id, tenantId), eq(tenants.resellerId, reseller.id)))
    .limit(1);
  if (!t) throw new IDORError("tenant_not_yours");
  return t;
}

export async function resellerCommissionsList(session: Session, options?: { periodMonth?: Date }) {
  const reseller = await getSessionReseller(session);
  return db.select({
    id: resellerCommissions.id,
    stripeInvoiceId: resellerCommissions.stripeInvoiceId,
    currency: resellerCommissions.currency,
    baseAmountCents: resellerCommissions.baseAmountCents,
    commissionAmountCents: resellerCommissions.commissionAmountCents,
    status: resellerCommissions.status,
    periodMonth: resellerCommissions.periodMonth,
    invoicePaidAt: resellerCommissions.invoicePaidAt,
  }).from(resellerCommissions)
    .where(and(
      eq(resellerCommissions.resellerId, reseller.id),
      options?.periodMonth ? eq(resellerCommissions.periodMonth, options.periodMonth) : undefined,
    ));
}

export async function resellerPayoutsList(session: Session) {
  const reseller = await getSessionReseller(session);
  return db.select().from(resellerPayouts)
    .where(eq(resellerPayouts.resellerId, reseller.id));
}

// Métricas de salud del tenant — agregadas y anonimizadas
export async function resellerTenantHealth(session: Session, tenantId: string) {
  const reseller = await getSessionReseller(session);
  const [t] = await db.select({ id: tenants.id }).from(tenants)
    .where(and(eq(tenants.id, tenantId), eq(tenants.resellerId, reseller.id)))
    .limit(1);
  if (!t) throw new IDORError("tenant_not_yours");
  // Queries agregadas a agent_configs (solo `paused`) y messages (conteos sin contenido)
  const [config] = await db.select({ paused: agentConfigs.paused }).from(agentConfigs)
    .where(eq(agentConfigs.tenantId, tenantId)).limit(1);
  const [msgStats] = await db.select({
    count: sql<number>`count(*)`.as("count"),
  }).from(messages)
    .where(and(
      eq(messages.tenantId, tenantId),
      gte(messages.createdAt, sql`now() - interval '30 days'`),
    ));
  return { paused: config?.paused ?? false, messages30d: msgStats?.count ?? 0 };
}
```

### 9.2 ESLint rule

`.eslintrc` custom rule `no-direct-tenant-query-in-reseller-routes`:

```js
{
  "rules": {
    "no-restricted-syntax": [
      "error",
      {
        "selector": "CallExpression[callee.property.name='from'][arguments.0.name=/^(tenants|messages|conversations|agentConfigs|providerCredentials)$/]",
        "message": "Use resellerScoped* helpers from @/lib/reseller/scope instead"
      }
    ]
  },
  "overrides": [
    {
      "files": ["app/reseller/**", "app/api/reseller/**"],
      "rules": { "no-restricted-syntax": "error" }
    }
  ]
}
```

Complementado con **test unitario** `tests/reseller/idor.test.ts`:
- Crea 2 resellers + 4 tenants (2 de cada).
- Autentica como reseller A, intenta fetch tenant de B → debe lanzar `IDORError`.
- Cobertura para: tenants list, tenant detail, commissions, payouts, tenant health.

### 9.3 Campos explícitamente FORBIDDEN para reseller

| Campo | Razón |
|-------|-------|
| `tenants.name` | Puede ser PII (nombre comercial real) |
| `tenants.legalName`, `taxId`, `billingAddress` | PII fiscal |
| `tenants.stripeCustomerId`, `stripeSubscriptionId` | Acceso a cuenta Stripe del tenant |
| `users.email`, `name`, `phone` | PII directo |
| `agentConfigs.systemPrompt`, `knowledge` | IP del negocio del tenant |
| `providerCredentials.*` (todo) | Credenciales Whapi/Meta cifradas pero sensibles |
| `messages.content`, `conversations.customerName` | Conversaciones con clientes finales |
| `platformSettings` | Keys globales |

Un reseller **nunca** debe poder hacer `db.select(...).from(cualquiera-de-estos)`. El ESLint rule + scope.ts lo garantizan.

---

## 10. UI

Sin cambios estructurales vs v1 excepto:
- **Sin pestaña Marketing** con branding custom (solo assets estándar Ordy)
- **Sin `/reseller/settings` → sección "Subdominio"** (no hay whitelabel)
- Settings del reseller se limita a: brand_name (solo para su dashboard interno), Stripe Connect onboarding, datos fiscales
- El "settings" del reseller **no permite cambiar slug** después del create (lo cambia super admin si necesario)

Resto idéntico a la descripción detallada del spec v1 (tablas shadcn, wizard 4-step con país primero, IDOR scope).

---

## 11. Seguridad — risk table v2 (post audit)

| # | Risk | Prob | Impact | Mitigation |
|---|------|------|--------|------------|
| 1 | IDOR reseller → tenants/messages/configs | Alta | Crítico | `lib/reseller/scope.ts` con allowlist explícita (§9) + ESLint rule + test IDOR |
| 2 | Commission double-credit Stripe retry | Alta | Alto | `stripeInvoiceId UNIQUE` + `onConflictDoNothing` + `stripe_events` dedupe + `db.transaction()` wrap |
| 3 | Self-referral | Alta | Medio | 30d hold + email match check + `audit_log` flag |
| 4 | `commission_rate` post-hoc manipulation | Media | Alto | `commissionRateSnapshot` NOT NULL + CHECK 0..0.5 + snapshot en tx |
| 5 | Cookie stuffing | Media | Medio | SameSite=Lax + host-scoped + Sec-Fetch-Dest + rate limit slug |
| 6 | Role escalation /admin via reseller | Baja | Crítico | Middleware role check + Auth.js union + `signIn` callback hardening (§5.2) |
| 7 | Refund sin reverse commission | Media | Alto | `charge.refunded` case + `commission_debt_cents` carry-over |
| 8 | Stripe Connect OAuth-like hijack | Baja | Alto | Callback valida `session.user.id === reseller.user_id` |
| 9 | KYC bypass | Baja | Alto | Gate doble (cron + transfer creation): `stripeConnectPayoutsEnabled=true` required |
| 10 | `account.application.deauthorized` stale | Baja | Medio | Handler auto-pause reseller + nullify Connect id |
| 11 | iOS ITP truncation | Cierto | Bajo | `ref_touches` dual-write 30d window |
| 12 | High-value payout by compromised admin | Baja | Crítico | Two-person 2FA approval para >=5000 EUR |
| 13 | Hard-delete accidental | Media | Alto | DB trigger `prevent_hard_delete` en 3 tablas |
| 14 | CSV formula injection | N/A v1 | — | **ELIMINADO** (sin export CSV en v1) |
| 15 | Logo XSS / SVG polyglot | N/A v1 | — | **ELIMINADO** (sin whitelabel en v1) |
| 16 | Subdomain takeover | N/A v1 | — | **ELIMINADO** (sin whitelabel en v1) |

---

## 12. Compliance

### 12.1 Legal gate ES — bloqueante pre-go-live

- [ ] **Reseller Agreement** redactado con cláusulas obligatorias (§12.2), firmado digitalmente al onboarding, versión trackada en `reseller_self_billing_consents.agreement_version`
- [ ] **ToS** enmendada con disclosure del programa de referidos
- [ ] **Privacy Policy** actualizada: sección cookie `ordy_ref`, finalidad atribución, retención 6 años
- [ ] **Cookie banner** con opt-in categoría atribución, botones Aceptar/Rechazar **equiprominentes** (AEPD)
- [ ] **Onboarding ES bloqueante**: `country_code='ES'` exige `iae_registered=TRUE` + `fiscal_sub_profile` + copia digital DNI/CIF + copia IAE (modelo 036/037) + consent self-billing (CONSTRAINT en DB ya lo enforce)
- [ ] **Mario alta como retenedor IRPF** si no lo está + pipeline Modelo 111/190 listos
- [ ] **Asesor fiscal colegiado valida** el pipeline 111/190/347/349 antes del primer payout (paso explícito bloqueante, no diferible)
- [ ] **VIES validation** activa para resellers UE (check al onboarding + cron trimestral revalidación)
- [ ] **Trigger DB `prevent_hard_delete`** aplicado y testeado (§3.1)

### 12.2 Reseller Agreement — cláusulas obligatorias (outline)

El contrato debe incluir expresamente:

1. **Naturaleza jurídica**: "El presente es un contrato mercantil de mediación/comisión (Código de Comercio art. 244 y ss.). **No constituye contrato de agencia** (Ley 12/1992) ni confiere derecho a indemnización por clientela (art. 28 LCA). **No constituye franquicia** (Ley 7/1996)."
2. **No-exclusividad bidireccional**: "Ninguna parte queda vinculada por exclusividad de zona, sector, o canal."
3. **Libertad de medios** (anti falso-autónomo): "El Reseller organiza libremente sus medios, horarios, métodos y asistentes. No está sometido a directrices operativas de Ordy Chat. No usa infraestructura, email corporativo, ni títulos de Ordy Chat."
4. **Comisión**: "25% de la base imponible (pre-IVA) de cada factura pagada por clientes referidos, mientras mantengan suscripción activa y al corriente de pago. Cap recomendado: 24 meses por cliente." (El cap 24m evita deriva hacia agencia indefinida.)
5. **Atribución**: "Mediante cookie `ordy_ref` con TTL 90 días, first-touch. Condicionada al consentimiento del cliente."
6. **Responsabilidad fiscal local** (fallback strategy): "El Reseller es única y exclusivamente responsable de sus obligaciones fiscales en su jurisdicción, incluyendo registros, declaraciones, y retenciones locales aplicables."
7. **Terminación**: "Cualquier parte puede terminar con 30 días de preaviso. Comisiones devengadas hasta la fecha se liquidan en el ciclo habitual. No hay indemnización por terminación."
8. **Protección de datos**: adenda DPA específica (reseller NO es sub-encargado de datos de clientes finales; solo maneja sus propios datos de contacto y fiscales).
9. **Limitación de responsabilidad**: cap a 12 meses de comisiones.
10. **Uso de marca Ordy**: licencia limitada a materiales oficiales provistos en `/reseller/marketing`. Sin derecho a co-branding o subdominio propio (v1).
11. **Ley aplicable y jurisdicción**: España, tribunales del domicilio de Ordy.
12. **Self-billing consent** (RD 1619/2012 art. 5.2) para Mario emita factura por el destinatario en strategy `es`.

### 12.3 Global note — resellers no-ES

Cláusula explícita en el Agreement: "For resellers outside Spain, Ordy Chat pays the base commission gross of local taxes. The Reseller is solely responsible for tax compliance in their jurisdiction (income tax, VAT/GST/sales tax, withholding, reporting)." Plugins específicos (US 1099-NEC, UK IR35) se añaden como strategies en v2 cuando exista reseller real en ese país.

### 12.4 GDPR

- Cookie `ordy_ref` requires opt-in (LSSI-CE art. 22.2)
- Reseller NO es sub-encargado (data minimization)
- Retención 6 años (Cco art. 30) enforced by DB trigger
- Right to erasure: soft-delete tenant PII (`tenants.legalName, taxId, billingAddress → NULL`) preservando commissions

---

## 13. Files — created vs touched (v2 reducido)

### Created (31 nuevos)

```
shared/migrations/012_resellers.sql
shared/migrations/012_resellers.rollback.sql

web/app/api/ref/touch/route.ts
web/app/api/reseller/stripe-connect/start/route.ts
web/app/api/reseller/stripe-connect/callback/route.ts
web/app/api/cron/commissions-mature/route.ts
web/app/api/cron/resellers-payout-run/route.ts
web/app/api/admin/resellers/create/route.ts
web/app/api/admin/resellers/[id]/status/route.ts
web/app/api/admin/payouts/[id]/approve/route.ts
web/app/admin/resellers/page.tsx
web/app/admin/resellers/new/page.tsx
web/app/admin/resellers/[id]/page.tsx
web/app/admin/payouts/page.tsx
web/app/reseller/page.tsx
web/app/reseller/tenants/page.tsx
web/app/reseller/tenants/[id]/page.tsx
web/app/reseller/commissions/page.tsx
web/app/reseller/payouts/page.tsx
web/app/reseller/settings/page.tsx
web/app/reseller/marketing/page.tsx

web/lib/reseller/scope.ts
web/lib/reseller/attribution.ts
web/lib/payouts/aggregate.ts
web/lib/payouts/registry.ts
web/lib/payouts/fx.ts
web/lib/payouts/stripe-transfer.ts
web/lib/payouts/invoice.ts
web/lib/payouts/strategies/types.ts
web/lib/payouts/strategies/es.ts
web/lib/payouts/strategies/eu-vat.ts
web/lib/payouts/strategies/fallback.ts

web/components/ui/data-table.tsx
web/components/ui/tabs.tsx
web/components/ui/stepper.tsx
web/components/reseller-share-card.tsx
web/components/cookie-consent.tsx
web/components/ref-tracker.tsx

tests/reseller/idor.test.ts
tests/reseller/attribution.test.ts
tests/reseller/commission-engine.test.ts
tests/reseller/tax-strategies.test.ts
tests/reseller/payout-engine.test.ts
tests/reseller/fixtures/resellers.ts
```

### Touched (8 existentes, patches quirúrgicos)

| File | Change | Líneas |
|------|--------|--------|
| `web/lib/db/schema.ts` | Append 5 tablas + 1 línea en `tenants` | ~120 append + 1 edit |
| `web/middleware.ts` | ref capture + `/reseller` guard + `/` matcher | ~30 new |
| `web/app/api/stripe/webhook/route.ts` | 6 cases nuevos en switch (invoice.paid + charge.refunded + payout.paid + payout.failed + account.updated + account.application.deauthorized), todo en `db.transaction()` | ~110 new |
| `web/lib/auth.ts` | Widen union 2 sitios + `signIn` callback hardening | +10 edits |
| `web/lib/onboarding-fast/provision.ts` | Hook resolveResellerAttribution antes del INSERT tenants | +3 lines |
| `web/lib/rate-limit.ts` | Añadir `limitByResellerSlug` + `limitByUserId` helpers | ~20 new |
| `web/vercel.json` | Añadir 2 cron entries (already exists) | +4 |
| `package.json` | `recharts`, `qrcode.react`, `@radix-ui/react-tabs` (dialog ya existe) | +3 deps |

**No refactor. No rename. No move. Solo append/insert.**

---

## 14. Roadmap — 5 fases (v1)

| Fase | Duración | Bloqueador | Entregable |
|------|----------|------------|------------|
| **F0 — DB + schema** | 1 día | — | Migración 012 aplicada en Neon branch, EXPLAIN hot queries verificado, Drizzle schema.ts append, tsc verde |
| **F1 — Atribución + consent** | 2-3 días | F0 | Middleware ref capture, `/api/ref/touch`, `ref_touches` INSERT, cookie banner, hook en provision.ts, cron mature diario. Tests: first-touch, iOS fallback, self-referral flag |
| **F2 — Super admin + rol reseller** | 3 días | F0, F1 | `/admin/resellers/*` con wizard 4-step (country→identity→commission→fiscal), rol `reseller` en Auth.js con signIn hardening. Test E2E: create reseller → magic link → login |
| **F3 — Reseller panel read-only** | 3-4 días | F2 | `/reseller/*` con todas las pages, `lib/reseller/scope.ts` con allowlist, ESLint rule, test IDOR completo |
| **F4 — Commission engine** | 2-3 días | F0, F2 | Webhook 6 cases en db.transaction, tests idempotencia + refund cross-period + self-billing SL ES warning |
| **F5 — Payout engine** | 5-6 días | F0, F2, F4 | Tax strategies (es/eu-vat/fallback), Stripe Connect start + callback + transfer, cron mensual, invoice generation vía verifactu, FX preview + post-hoc, two-person approval ≥5000 EUR. Tests: 4 perfiles fiscales + E2E signup→commission→payout |

**Total estimado: 16-19 días efectivos.** F5 es el más cargado — tax strategies + Connect + FX + invoicing + 2-person approval.

Al final de cada fase:
1. `pnpm tsc --noEmit` → 0 errors
2. `pnpm lint` → 0 errors
3. Tests de la fase verdes (definidos en §18)
4. Commit firmado SSH (regla usuario)
5. Mini-audit de esa fase por auditor fresh-context → READY antes de siguiente

---

## 15. Open questions (resueltas + restantes)

**Resueltas en v2:**
- ✅ Tenant creation entry point: `web/lib/onboarding-fast/provision.ts:116`
- ✅ Número de migración: **012** (010/011 tomadas por validator)
- ✅ `vercel.json` existe con 3 crons — add 2 more
- ✅ Form validation library: **Zod** (`^3.23.8` ya instalado) + Server Actions (no react-hook-form)
- ✅ `@radix-ui/react-dialog` ya instalado — reutilizar
- ✅ Stripe events correctos: `payout.paid`/`payout.failed`/`account.updated`/`account.application.deauthorized` (no `transfer.*`)
- ✅ FX flow: ECB preview + `balance_transaction.exchange_rate` post-transfer
- ✅ Anti-hard-delete trigger implementado en SQL
- ✅ IAE + fiscal_sub_profile como CONSTRAINT de DB para ES

**Restantes (no bloquean el plan, bloquean puntos específicos):**
1. **CSP en `next.config.ts`**: verificar estado actual; si no existe, añadir CSP base como parte de F1 (bajo riesgo sin whitelabel, pero buena higiene). Owner: F1.
2. **Verifactu function signature**: confirmar que `web/lib/verifactu/` expone una API para self-billing o si hay que extenderla. Owner: F5 primer día, bloquea tax strategy `es`.
3. **`ORDY_NIF` / datos fiscales de Mario**: env vars para las facturas auto-emitidas. Owner: F5.
4. **MIN_PAYOUT_CENTS**: confirmar 1000 (10 EUR) o distinto. Owner: F5.
5. **Cookie consent preexistente**: verificar si ya hay banner en el repo; si no, componente nuevo F1.
6. **Stripe Connect activado en cuenta de Mario**: verificar en dashboard Stripe, activar Connect + Express si no lo está. Owner: pre-F5 infra task.
7. **Two-person 2FA**: verificar si Auth.js v5 tiene TOTP integrable; si no, usar `/admin/security/setup-totp` como prereq de F5.

---

## 16. Env vars nuevas

Añadir a `.env.example`:

```bash
# Reseller program (v1)
ORDY_NIF=B12345678                  # NIF/CIF de Mario para self-billing invoices
ORDY_LEGAL_NAME="Ordy Chat SL"      # Razón social
ORDY_BILLING_ADDRESS_JSON='{"street":"...", "city":"Madrid", "postal_code":"28001", "country":"ES"}'

# Stripe Connect
STRIPE_CONNECT_CLIENT_ID=ca_xxx      # Platform Connect client ID
STRIPE_CONNECT_WEBHOOK_SECRET=whsec_xxx  # Webhook secret para connected account events
# (si webhook secret es el mismo endpoint que el actual, reutilizar STRIPE_WEBHOOK_SECRET existente)

# Payouts
MIN_PAYOUT_CENTS=1000               # 10 EUR mínimo para generar payout
HIGH_VALUE_PAYOUT_CENTS=500000      # 5000 EUR requiere 2-person approval

# FX
ECB_RATES_URL=https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml

# Attribution
ORDY_REF_COOKIE_DAYS=90
REF_TOUCH_HOLD_DAYS=30
COMMISSION_MATURE_DAYS=30

# Optional (telemetry)
AUDIT_LOG_VERBOSE=0
```

---

## 17. Testing strategy

### Test files to create (listados en §13)

**tests/reseller/idor.test.ts** (F3, bloquea merge):
- 2 resellers, 4 tenants (2 cada uno)
- Auth como reseller A, assert cannot access tenant de B en: tenants list, tenant detail, commissions, payouts, tenant health
- Auth como reseller A, assert cannot `db.select().from(messages)` (ESLint catch)
- Auth como super_admin, assert can access todo
- Auth como tenant_admin, assert redirect fuera de `/reseller/*`

**tests/reseller/attribution.test.ts** (F1):
- First-touch guarantee (segundo ?ref= no sobrescribe)
- Cookie con consent → se setea. Sin consent → no
- iOS ITP simulation (cookie dies → `ref_touches` fallback 30d window resuelve)
- Self-referral detection → flag en audit_log
- Reseller inactive → cookie no vale (fallback a null)
- Rate limits slug/IP

**tests/reseller/commission-engine.test.ts** (F4):
- `invoice.paid` happy path crea commission con snapshot
- `invoice.paid` retry (mismo stripe_invoice_id) → no-op
- `charge.refunded` → status=reversed
- Refund cross-period → `commission_debt_cents` incrementa
- Coupon 100% off (base=0) → no commission
- Reseller inactive al momento del invoice → no commission
- Race: rate cambia entre SELECT y INSERT → snapshot usa valor leído (no el nuevo)

**tests/reseller/tax-strategies.test.ts** (F5):
- Fixtures: 4 resellers (autonomo_es, sl_es, eu_vat, fallback)
- Cada uno: calculate breakdown con `source_cents=41100` (411.00 EUR commission típica 1-mes 100 tenants)
- Assert IRPF 15% autonomo_es, 0% sl_es con warning, 0% eu_vat, 0% fallback
- Assert IVA 21% es, 0% eu_vat, 0% fallback
- Canarias: IGIC 7% en vez de IVA
- `autonomo_new_es` flag → IRPF 7%

**tests/reseller/payout-engine.test.ts** (F5):
- Cron genera draft payouts correctamente
- KYC gate: reseller sin `payoutsEnabled` → skipped
- MIN_PAYOUT carry-forward funciona
- `requires_high_value_approval=TRUE` si >=5000 EUR
- E2E signup → 3 meses de invoices → payout generado → Mario aprueba → transfer created → payout.paid webhook → status=paid

**Fixtures compartidas `tests/reseller/fixtures/resellers.ts`**: 4 perfiles fiscales, cada uno con tenants seed-ready, Stripe mock invoices pre-computadas.

---

## 18. Audit & review plan v2

1. **Re-audit quirúrgico** con los 5 agentes, pero **solo verificando los findings corregidos** (no re-audit completo). Checklist por agente: "¿el blocker X del audit anterior está resuelto en el spec v2? Sí/No/Parcial con evidencia de línea/sección."
2. **Iteración si cualquier finding remanente**
3. **Presentar v2 final a Mario para aprobación formal**
4. **Commit del spec firmado SSH** una vez aprobado
5. **Invocar `superpowers:writing-plans`** para generar plan TDD task-por-task, fase-a-fase

---

## 19. Primeros 3 comandos (plug-and-play)

```bash
# 1. Crear branch Neon de migración
cd ~/Projects/whatsapp-agentkit
git checkout -b feat/reseller-panel
# (Usar mcp__Neon__create_branch para crear branch reseller-migration en Neon)

# 2. Aplicar migración 012 (vía Neon MCP, NO drizzle-kit migrate — pooler hang)
# mcp__Neon__run_sql_transaction con contenido de shared/migrations/012_resellers.sql

# 3. Verificar schema + instalar deps
cd web
pnpm install recharts qrcode.react @radix-ui/react-tabs
pnpm tsc --noEmit  # debe ser 0 errors después del append a schema.ts
```

---

## Changelog v1 → v2

**Scope cuts:**
- ❌ Mode A SEPA (manual payout con XML pain.001 + CSV export)
- ❌ White-label subdomain con branding custom (logo upload, brand color, DNS wildcard)

**Fixes críticos aplicados:**
- Migración numerada **012** (010/011 tomadas por validator)
- Stripe events corregidos: `payout.paid`/`payout.failed`/`account.updated`/`account.application.deauthorized` (no `transfer.*`)
- `Stripe.Transfer.failure_code/message` movido a `Stripe.Payout` handler (typecheck OK)
- FX flow: ECB daily preview + `balance_transaction.exchange_rate` post-transfer
- `vercel.json` existe con 3 crons — se añaden 2
- `db.transaction()` wrap en todos los webhook cases de commissions
- `signIn` callback hardening contra escalation via SUPER_ADMIN_EMAIL
- IDOR scope.ts con field allowlist EXPLÍCITA para tenants/commissions/payouts/health + ESLint rule + test
- Trigger DB `prevent_hard_delete` implementado en SQL
- KYC gate doble (cron + transfer creation) verifica `stripeConnectPayoutsEnabled`
- Two-person 2FA approval para payouts ≥5000 EUR
- Coupons/credits edge case: usa `subtotal_excluding_tax` priorizado, skip si base=0
- Regex slug sincronizado entre middleware y CHECK de DB
- CONSTRAINT DB: ES reseller exige `iae_registered=TRUE` + `fiscal_sub_profile`
- CONSTRAINT DB: status='active' exige `stripe_connect_account_id` no-null
- `limitByResellerSlug` + `limitByUserId` helpers nuevos en rate-limit.ts
- Max-length CHECKs en TEXT columns (brand_name, utm_*, user_agent, referer, etc.)
- `refunded_at` timestamp en commission al reversar
- `commission_debt_cents` carry-over documentado para refund cross-period
- Cookie banner con botones Aceptar/Rechazar equiprominentes (AEPD)
- Reseller Agreement outline con cláusulas anti-agencia + anti-falso-autónomo + mediación mercantil
- Open questions reducidas de 10 a 7 (3 resueltas, 3 diferidas a infra pre-F5)
- §16 Env vars nuevas enumeradas explícitamente
- §17 Testing strategy con 6 test files listados por fase
- §19 Primeros 3 comandos bash para arrancar

**Findings eliminados por cuts:**
- SEPA XML builder lib decision → eliminado (sin SEPA)
- CSV formula injection → eliminado (sin export CSV)
- IBAN encryption + rotation → eliminado (sin IBAN)
- RESERVED_SUBDOMAINS list completeness → eliminado (sin whitelabel)
- Logo SVG XSS → eliminado (sin logo upload)
- `brand_color` CSS injection → eliminado (sin whitelabel)
- DNS wildcard infra → eliminado
- LSSI art. 10 whitelabel footer → eliminado
- Subdomain takeover → eliminado
- CSP para branding dinámico → eliminado (CSP general sigue siendo buena idea pero menos crítica)

---

**Fin del spec v2.**
