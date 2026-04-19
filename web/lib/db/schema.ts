// web/lib/db/schema.ts — Schema Drizzle (espejo de shared/schema.sql)

import {
  bigint,
  bigserial,
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

// ── Users / Auth.js ─────────────────────────────────────────
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").unique().notNull(),
  name: text("name"),
  emailVerified: timestamp("email_verified", { withTimezone: true }),
  image: text("image"),
  role: text("role").notNull().default("tenant_admin"),
  // Hash argon2id. NULL = usuario sin login directo (sólo magic link / OAuth).
  passwordHash: text("password_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    id_token: text("id_token"),
    scope: text("scope"),
    session_state: text("session_state"),
    token_type: text("token_type"),
  },
  (t) => ({ pk: primaryKey({ columns: [t.provider, t.providerAccountId] }) }),
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.identifier, t.token] }) }),
);

// ── Tenants ─────────────────────────────────────────────────
export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").unique().notNull(),
  name: text("name").notNull(),
  ownerUserId: uuid("owner_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  subscriptionStatus: text("subscription_status").notNull().default("trialing"),
  stripeCustomerId: text("stripe_customer_id").unique(),
  stripeSubscriptionId: text("stripe_subscription_id").unique(),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }).notNull(),
  // Datos fiscales + branding (migración 003).
  legalName: text("legal_name"),
  taxId: text("tax_id"),
  billingAddress: text("billing_address"),
  billingPostalCode: text("billing_postal_code"),
  billingCity: text("billing_city"),
  billingCountry: text("billing_country").notNull().default("ES"),
  brandColor: text("brand_color").notNull().default("#7c3aed"),
  brandLogoUrl: text("brand_logo_url"),
  defaultVatRate: numeric("default_vat_rate", { precision: 5, scale: 2 }).notNull().default("10.00"),
  // Régimen fiscal multi-región (migración 008).
  taxRegion: text("tax_region").notNull().default("es_peninsula"),
  taxSystem: text("tax_system").notNull().default("IVA"),
  pricesIncludeTax: boolean("prices_include_tax").notNull().default(true),
  taxRateStandard: numeric("tax_rate_standard", { precision: 5, scale: 2 }).notNull().default("10.00"),
  taxRateAlcohol: numeric("tax_rate_alcohol", { precision: 5, scale: 2 }).notNull().default("21.00"),
  taxLabel: text("tax_label").notNull().default("IVA"),
  // Reseller program (migración 012) — NULL = venta directa Ordy, no atribuido a reseller.
  resellerId: uuid("reseller_id").references((): AnyPgColumn => resellers.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tenantMembers = pgTable(
  "tenant_members",
  {
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("owner"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.tenantId, t.userId] }) }),
);

// ── Agent config ────────────────────────────────────────────
import { sql as _sqlTag } from "drizzle-orm";

export const agentConfigs = pgTable("agent_configs", {
  tenantId: uuid("tenant_id").primaryKey().references(() => tenants.id, { onDelete: "cascade" }),
  businessName: text("business_name").notNull(),
  businessDescription: text("business_description").notNull().default(""),
  agentName: text("agent_name").notNull().default("Asistente"),
  tone: text("tone").notNull().default("friendly"),
  schedule: text("schedule").notNull().default("24/7"),
  useCases: jsonb("use_cases").notNull().default([]),
  systemPrompt: text("system_prompt").notNull(),
  fallbackMessage: text("fallback_message").notNull(),
  errorMessage: text("error_message").notNull(),
  knowledge: jsonb("knowledge").notNull().default([]),
  paused: boolean("paused").notNull().default(false),
  onboardingCompleted: boolean("onboarding_completed").notNull().default(false),
  maxMessagesPerHour: integer("max_messages_per_hour").notNull().default(200),
  paymentMethods: text("payment_methods").array().notNull().default(_sqlTag`ARRAY['on_pickup','cash']::text[]`),
  acceptOnlinePayment: boolean("accept_online_payment").notNull().default(false),
  paymentNotes: text("payment_notes"),
  // Sprint 3 validador-ui (migración 011): override del validation_mode por tenant.
  // NULL → usa flag global platform_settings.validation_mode_default.
  // 'auto'|'manual'|'skip' → override explícito para este tenant.
  validationMode: text("validation_mode"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── FAQs (migración 007) ────────────────────────────────────
export const faqs = pgTable("faqs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  orderIndex: integer("order_index").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Faq = typeof faqs.$inferSelect;

// ── Provider credentials ────────────────────────────────────
export const providerCredentials = pgTable("provider_credentials", {
  tenantId: uuid("tenant_id").primaryKey().references(() => tenants.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  credentialsEncrypted: text("credentials_encrypted").notNull(),
  phoneNumber: text("phone_number"),
  webhookSecret: text("webhook_secret"),
  webhookVerified: boolean("webhook_verified").notNull().default(false),
  // Warm-up anti-ban (migración 009). instance_created_at arranca como NULL en la
  // migración y se backfill-ea a now() - 30 días para filas preexistentes; nuevas
  // filas usan DEFAULT now(). Drizzle lo modela como notNull + defaultNow.
  instanceCreatedAt: timestamp("instance_created_at", { withTimezone: true }).notNull().defaultNow(),
  burned: boolean("burned").notNull().default(false),
  burnedAt: timestamp("burned_at", { withTimezone: true }),
  burnedReason: text("burned_reason"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Conversations / Messages ────────────────────────────────
export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  phone: text("phone").notNull(),
  customerName: text("customer_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
});

export const messages = pgTable("messages", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  mensajeId: text("mensaje_id"),
  tokensIn: integer("tokens_in").default(0),
  tokensOut: integer("tokens_out").default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const processedMessages = pgTable(
  "processed_messages",
  {
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    mensajeId: text("mensaje_id").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.tenantId, t.mensajeId] }) }),
);

// ── Platform settings (super admin) ─────────────────────────
export const platformSettings = pgTable("platform_settings", {
  key: text("key").primaryKey(),
  valueEncrypted: text("value_encrypted").notNull().default(""),
  description: text("description"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by").references(() => users.id),
});

// ── Stripe events dedupe (migración 004) ────────────────────
// Si Stripe reintenta un webhook, un INSERT ... ON CONFLICT DO NOTHING
// en esta tabla hace el handler idempotente: si devuelve 0 filas insertadas,
// saltamos el procesamiento.
export const stripeEvents = pgTable("stripe_events", {
  eventId: text("event_id").primaryKey(),
  eventType: text("event_type").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Audit log ───────────────────────────────────────────────
export const auditLog = pgTable("audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "set null" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  entity: text("entity"),
  entityId: text("entity_id"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Fiscal config + Verifactu (migración 003) ─────────────
export const tenantFiscalConfig = pgTable("tenant_fiscal_config", {
  tenantId: uuid("tenant_id").primaryKey().references(() => tenants.id, { onDelete: "cascade" }),
  verifactuEnabled: boolean("verifactu_enabled").notNull().default(false),
  verifactuEnvironment: text("verifactu_environment").notNull().default("sandbox"),
  certificateEncrypted: text("certificate_encrypted"),
  certificatePasswordEncrypted: text("certificate_password_encrypted"),
  certificateFilename: text("certificate_filename"),
  certificateUploadedAt: timestamp("certificate_uploaded_at", { withTimezone: true }),
  certificateExpiresAt: timestamp("certificate_expires_at", { withTimezone: true }),
  invoiceSeries: text("invoice_series").notNull().default("A"),
  invoiceCounter: bigint("invoice_counter", { mode: "number" }).notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Pedidos + recibos (mesero digital) ─────────────────────
export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    customerPhone: text("customer_phone"),
    customerName: text("customer_name"),
    tableNumber: text("table_number"),
    status: text("status").notNull().default("pending"),
    currency: text("currency").notNull().default("EUR"),
    subtotalCents: integer("subtotal_cents").notNull().default(0),
    // vatCents queda DEPRECATED — callers nuevos usan taxCents. Durante transición
    // escribimos en ambos con el mismo valor para compatibilidad retroactiva.
    vatCents: integer("vat_cents").notNull().default(0),
    taxCents: integer("tax_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull().default(0),
    stripePaymentLinkUrl: text("stripe_payment_link_url"),
    stripePaymentIntentId: text("stripe_payment_intent_id").unique(),
    stripeCheckoutSessionId: text("stripe_checkout_session_id").unique(),
    notes: text("notes"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export const orderItems = pgTable("order_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  quantity: integer("quantity").notNull().default(1),
  unitPriceCents: integer("unit_price_cents").notNull(),
  // vatRate DEPRECATED — usar taxRate. Durante transición ambos se llenan igual.
  vatRate: numeric("vat_rate", { precision: 5, scale: 2 }).notNull().default("10.00"),
  taxRate: numeric("tax_rate", { precision: 5, scale: 2 }).notNull().default("10.00"),
  taxLabel: text("tax_label").notNull().default("IVA"),
  lineTotalCents: integer("line_total_cents").notNull(),
  notes: text("notes"),
});

export const receipts = pgTable(
  "receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id").unique().notNull().references(() => orders.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    invoiceSeries: text("invoice_series").notNull(),
    invoiceNumber: bigint("invoice_number", { mode: "number" }).notNull(),
    verifactuStatus: text("verifactu_status").notNull().default("skipped"),
    verifactuSubmittedAt: timestamp("verifactu_submitted_at", { withTimezone: true }),
    verifactuResponse: jsonb("verifactu_response"),
    verifactuQrData: text("verifactu_qr_data"),
    verifactuHash: text("verifactu_hash"),
    pdfUrl: text("pdf_url"),
    sentEmail: text("sent_email"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ uniqNumber: unique().on(t.tenantId, t.invoiceSeries, t.invoiceNumber) }),
);

export type User = typeof users.$inferSelect;
export type Tenant = typeof tenants.$inferSelect;
export type AgentConfig = typeof agentConfigs.$inferSelect;
export type ProviderCredentials = typeof providerCredentials.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type TenantFiscalConfig = typeof tenantFiscalConfig.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type Receipt = typeof receipts.$inferSelect;

// ── Appointments + handoff (migración 006) ─────────────────
export const appointments = pgTable("appointments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  customerPhone: text("customer_phone").notNull(),
  customerName: text("customer_name"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  durationMin: integer("duration_min").notNull().default(30),
  title: text("title").notNull(),
  notes: text("notes"),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const handoffRequests = pgTable("handoff_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  customerPhone: text("customer_phone").notNull(),
  customerName: text("customer_name"),
  reason: text("reason").notNull(),
  priority: text("priority").notNull().default("normal"),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  handledAt: timestamp("handled_at", { withTimezone: true }),
  handledBy: uuid("handled_by").references(() => users.id, { onDelete: "set null" }),
});

export type Appointment = typeof appointments.$inferSelect;
export type HandoffRequest = typeof handoffRequests.$inferSelect;

// ── Onboarding jobs (migración 009) ─────────────────────────
// Jobs de scraping + merger del onboarding fast. NO es tabla multi-tenant
// (tenant aún no existe) — filtra por user_id. RLS activa defense-in-depth.
export const onboardingJobs = pgTable("onboarding_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  urlsJson: jsonb("urls_json").notNull(),
  status: text("status").notNull(),  // CHECK enforza: pending|scraping|sources_ready|ready|confirming|done|failed
  resultJson: jsonb("result_json"),
  error: text("error"),
  // Consent RGPD (art.6.1.a) + legal: log de "soy propietario, autorizo scrape".
  consentAcceptedAt: timestamp("consent_accepted_at", { withTimezone: true }),
  consentIp: text("consent_ip"),  // Postgres es INET; Drizzle usa text (la columna acepta cast).
  scrapeStartedAt: timestamp("scrape_started_at", { withTimezone: true }),
  scrapeDeadlineAt: timestamp("scrape_deadline_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type OnboardingJob = typeof onboardingJobs.$inferSelect;
export type NewOnboardingJob = typeof onboardingJobs.$inferInsert;

// ── Validator runs + messages (migración 010) ───────────────
// Sprint 2 validador-core. Se pobla solo desde runtime. RLS activa con
// current_tenant_id() helper. Super admin ve vía SET app.current_tenant_id.
export const validatorRuns = pgTable("validator_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  triggeredBy: text("triggered_by").notNull(), // CHECK: onboarding_auto|admin_manual|autopatch_retry
  nicho: text("nicho").notNull(), // universal_only|restaurante|clinica|hotel|servicios
  status: text("status").notNull(), // CHECK: running|pass|review|fail|error
  summaryJson: jsonb("summary_json"),
  autopatchAttempts: integer("autopatch_attempts").notNull().default(0),
  autopatchAppliedAt: timestamp("autopatch_applied_at", { withTimezone: true }),
  previousSystemPrompt: text("previous_system_prompt"),
  pausedByThisRun: boolean("paused_by_this_run").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const validatorMessages = pgTable("validator_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull().references(() => validatorRuns.id, { onDelete: "cascade" }),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  seedId: text("seed_id").notNull(),
  seedText: text("seed_text").notNull(),
  seedExpectedAction: text("seed_expected_action"),
  responseText: text("response_text").notNull(),
  toolsCalled: jsonb("tools_called"),
  assertsResult: jsonb("asserts_result"),
  judgeScores: jsonb("judge_scores"),
  judgeNotes: text("judge_notes"),
  verdict: text("verdict").notNull(), // CHECK: pass|review|fail
  tokensIn: integer("tokens_in").default(0),
  tokensOut: integer("tokens_out").default(0),
  durationMs: integer("duration_ms"),
  // Sprint 3 validador-ui (migración 011): decisión admin en modo manual/review.
  adminDecision: text("admin_decision"), // CHECK: approved|rejected|edited
  adminDecidedAt: timestamp("admin_decided_at", { withTimezone: true }),
  adminDecidedBy: uuid("admin_decided_by").references(() => users.id, { onDelete: "set null" }),
  adminEditedResponse: text("admin_edited_response"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ValidatorRun = typeof validatorRuns.$inferSelect;
export type NewValidatorRun = typeof validatorRuns.$inferInsert;
export type ValidatorMessage = typeof validatorMessages.$inferSelect;
export type NewValidatorMessage = typeof validatorMessages.$inferInsert;

// ── Reseller program (migración 012) ────────────────────────
// Stripe Connect único rail de payout v1. Sin white-label visual.
// 3 tax strategies pluggable: es / eu-vat / fallback.

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

export const refTouches = pgTable(
  "ref_touches",
  {
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
  },
  (t) => ({ uniqAnonReseller: unique().on(t.anonId, t.resellerId) }),
);

export const resellerPayouts = pgTable(
  "reseller_payouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    resellerId: uuid("reseller_id").notNull().references(() => resellers.id, { onDelete: "restrict" }),
    periodMonth: date("period_month", { mode: "date" }).notNull(),
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
    parentPayoutId: uuid("parent_payout_id").references((): AnyPgColumn => resellerPayouts.id, { onDelete: "set null" }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ uniqPeriod: unique().on(t.resellerId, t.periodMonth, t.payoutCurrency) }),
);

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
  periodMonth: date("period_month", { mode: "date" }).notNull(),
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

export type Reseller = typeof resellers.$inferSelect;
export type NewReseller = typeof resellers.$inferInsert;
export type RefTouch = typeof refTouches.$inferSelect;
export type NewRefTouch = typeof refTouches.$inferInsert;
export type ResellerCommission = typeof resellerCommissions.$inferSelect;
export type NewResellerCommission = typeof resellerCommissions.$inferInsert;
export type ResellerPayout = typeof resellerPayouts.$inferSelect;
export type NewResellerPayout = typeof resellerPayouts.$inferInsert;
export type ResellerSelfBillingConsent = typeof resellerSelfBillingConsents.$inferSelect;
