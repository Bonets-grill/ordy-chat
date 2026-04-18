// web/lib/reseller/scope.ts
// IDOR scope helpers para el panel reseller.
//
// REGLA: cualquier query en /app/reseller/** o /app/api/reseller/** debe pasar
// por aquí. Prohibido hacer db.select().from(tenants|messages|conversations|
// agentConfigs|providerCredentials) directo en esas rutas (enforce via review).
//
// Allowlist estricta: un reseller NO debe ver:
// - email/phone/nombre del owner del tenant
// - agent_configs.systemPrompt, knowledge
// - provider_credentials (ningún campo)
// - messages.content, conversations.customerName
// - stripe_customer_id, stripe_subscription_id
// - platform_settings
// - users.email, users.name, users.phone

import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { Session } from "next-auth";
import { db } from "@/lib/db";
import {
  agentConfigs,
  messages,
  resellerCommissions,
  resellerPayouts,
  resellers,
  tenants,
} from "@/lib/db/schema";

export class IDORError extends Error {
  constructor(public code: "forbidden_role" | "no_reseller_linked" | "tenant_not_yours") {
    super(code);
    this.name = "IDORError";
  }
}

/** Obtiene el reseller row de la sesión. Tira IDORError si no aplica. */
export async function getSessionReseller(session: Session | null) {
  if (!session?.user?.id) throw new IDORError("forbidden_role");
  if (session.user.role !== "reseller") throw new IDORError("forbidden_role");
  const [r] = await db.select().from(resellers).where(eq(resellers.userId, session.user.id)).limit(1);
  if (!r) throw new IDORError("no_reseller_linked");
  return r;
}

/** Campos del tenant visibles para el reseller (allowlist). */
export const TENANT_RESELLER_FIELDS = {
  id: tenants.id,
  slug: tenants.slug,
  subscriptionStatus: tenants.subscriptionStatus,
  trialEndsAt: tenants.trialEndsAt,
  createdAt: tenants.createdAt,
} as const;

/** Lista todos los tenants atribuidos al reseller de la sesión. */
export async function resellerTenantsList(session: Session | null) {
  const r = await getSessionReseller(session);
  return db
    .select(TENANT_RESELLER_FIELDS)
    .from(tenants)
    .where(eq(tenants.resellerId, r.id))
    .orderBy(desc(tenants.createdAt));
}

/** Obtiene un tenant específico (con scope check). */
export async function resellerTenantById(session: Session | null, tenantId: string) {
  const r = await getSessionReseller(session);
  const [t] = await db
    .select(TENANT_RESELLER_FIELDS)
    .from(tenants)
    .where(and(eq(tenants.id, tenantId), eq(tenants.resellerId, r.id)))
    .limit(1);
  if (!t) throw new IDORError("tenant_not_yours");
  return t;
}

/**
 * Salud del agente del tenant — solo agregados, nada de contenido.
 * El reseller ve: pausado (sí/no), mensajes últimos 30d (conteo), y punto.
 * NO conversaciones, NO prompts, NO credenciales.
 */
export async function resellerTenantHealth(session: Session | null, tenantId: string) {
  await resellerTenantById(session, tenantId); // scope check (tira si no)

  const [config] = await db
    .select({ paused: agentConfigs.paused, onboardingCompleted: agentConfigs.onboardingCompleted })
    .from(agentConfigs)
    .where(eq(agentConfigs.tenantId, tenantId))
    .limit(1);

  const [msgStats] = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(messages)
    .where(
      and(
        eq(messages.tenantId, tenantId),
        gte(messages.createdAt, sql`now() - interval '30 days'`),
      ),
    );

  return {
    paused: config?.paused ?? false,
    onboardingCompleted: config?.onboardingCompleted ?? false,
    messages30d: msgStats?.count ?? 0,
  };
}

/** Comisiones del reseller, opcionalmente filtradas por periodo. */
export async function resellerCommissionsList(
  session: Session | null,
  options?: { periodMonth?: Date },
) {
  const r = await getSessionReseller(session);
  const conditions = [eq(resellerCommissions.resellerId, r.id)];
  if (options?.periodMonth) conditions.push(eq(resellerCommissions.periodMonth, options.periodMonth));

  return db
    .select({
      id: resellerCommissions.id,
      stripeInvoiceId: resellerCommissions.stripeInvoiceId,
      currency: resellerCommissions.currency,
      baseAmountCents: resellerCommissions.baseAmountCents,
      commissionAmountCents: resellerCommissions.commissionAmountCents,
      commissionRateSnapshot: resellerCommissions.commissionRateSnapshot,
      status: resellerCommissions.status,
      periodMonth: resellerCommissions.periodMonth,
      invoicePaidAt: resellerCommissions.invoicePaidAt,
      tenantId: resellerCommissions.tenantId,
    })
    .from(resellerCommissions)
    .where(and(...conditions))
    .orderBy(desc(resellerCommissions.invoicePaidAt));
}

/** Payouts del reseller. */
export async function resellerPayoutsList(session: Session | null) {
  const r = await getSessionReseller(session);
  return db
    .select()
    .from(resellerPayouts)
    .where(eq(resellerPayouts.resellerId, r.id))
    .orderBy(desc(resellerPayouts.periodMonth));
}

/** Resumen KPIs para home: tenants activos, pendiente, pagado. */
export async function resellerKpis(session: Session | null) {
  const r = await getSessionReseller(session);
  const [tenantStats] = await db
    .select({
      n: sql<number>`cast(count(*) as int)`,
      active: sql<number>`cast(count(*) filter (where ${tenants.subscriptionStatus} = 'active') as int)`,
    })
    .from(tenants)
    .where(eq(tenants.resellerId, r.id));
  const [pending] = await db
    .select({
      s: sql<number>`coalesce(sum(${resellerCommissions.commissionAmountCents}), 0)::int`,
    })
    .from(resellerCommissions)
    .where(
      sql`${resellerCommissions.resellerId} = ${r.id} AND ${resellerCommissions.status} IN ('pending','payable')`,
    );
  const [paid] = await db
    .select({
      s: sql<number>`coalesce(sum(${resellerCommissions.commissionAmountCents}), 0)::int`,
    })
    .from(resellerCommissions)
    .where(
      sql`${resellerCommissions.resellerId} = ${r.id} AND ${resellerCommissions.status} = 'paid'`,
    );
  return {
    reseller: r,
    tenantsTotal: tenantStats?.n ?? 0,
    tenantsActive: tenantStats?.active ?? 0,
    pendingCents: pending?.s ?? 0,
    paidCents: paid?.s ?? 0,
  };
}
