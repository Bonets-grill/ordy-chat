// web/lib/db/schema.ts — Schema Drizzle (espejo de shared/schema.sql)

import {
  bigint,
  bigserial,
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

// ── Users / Auth.js ─────────────────────────────────────────
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").unique().notNull(),
  name: text("name"),
  emailVerified: timestamp("email_verified", { withTimezone: true }),
  image: text("image"),
  role: text("role").notNull().default("tenant_admin"),
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
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Provider credentials ────────────────────────────────────
export const providerCredentials = pgTable("provider_credentials", {
  tenantId: uuid("tenant_id").primaryKey().references(() => tenants.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  credentialsEncrypted: text("credentials_encrypted").notNull(),
  phoneNumber: text("phone_number"),
  webhookSecret: text("webhook_secret"),
  webhookVerified: boolean("webhook_verified").notNull().default(false),
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
    vatCents: integer("vat_cents").notNull().default(0),
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
  vatRate: numeric("vat_rate", { precision: 5, scale: 2 }).notNull().default("10.00"),
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
