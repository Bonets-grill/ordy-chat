// web/lib/tenant.ts — Helpers para el tenant del usuario actual.

import { and, desc, eq } from "drizzle-orm";
import { auth } from "./auth";
import { db } from "./db";
import { agentConfigs, tenantMembers, tenants } from "./db/schema";

export type TenantBundle = {
  tenant: typeof tenants.$inferSelect;
  config: typeof agentConfigs.$inferSelect | null;
  trialDaysLeft: number;
};

export async function requireTenant(): Promise<TenantBundle | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  const [membership] = await db
    .select({ tenant: tenants })
    .from(tenantMembers)
    .innerJoin(tenants, eq(tenants.id, tenantMembers.tenantId))
    .where(eq(tenantMembers.userId, session.user.id))
    .orderBy(desc(tenants.createdAt))
    .limit(1);

  if (!membership) return null;

  const [config] = await db
    .select()
    .from(agentConfigs)
    .where(eq(agentConfigs.tenantId, membership.tenant.id))
    .limit(1);

  const msLeft = membership.tenant.trialEndsAt.getTime() - Date.now();
  const trialDaysLeft = Math.max(0, Math.ceil(msLeft / (1000 * 60 * 60 * 24)));

  return { tenant: membership.tenant, config: config ?? null, trialDaysLeft };
}

export async function tenantBySlugOwned(slug: string) {
  const session = await auth();
  if (!session?.user?.id) return null;
  const [row] = await db
    .select({ tenant: tenants })
    .from(tenantMembers)
    .innerJoin(tenants, eq(tenants.id, tenantMembers.tenantId))
    .where(and(eq(tenantMembers.userId, session.user.id), eq(tenants.slug, slug)))
    .limit(1);
  return row?.tenant ?? null;
}
