// web/lib/admin/queries.ts — Queries agregados del super admin.
//
// Usa SQL raw vía drizzle `sql\`...\`` para joins + CASE complejo que Drizzle
// ORM no expresa limpiamente. Parámetros tipados con $1..$N.

import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { onboardingJobs, providerCredentials } from "@/lib/db/schema";

// ─── Onboarding jobs KPIs ───────────────────────────────────

export type OnboardingJobStatus =
  | "pending"
  | "scraping"
  | "sources_ready"
  | "ready"
  | "confirming"
  | "done"
  | "failed";

export type OnboardingJobsKpis = {
  by_status: Record<OnboardingJobStatus, number>;
  active_count: number;
  failed_24h: number;
};

const ACTIVE_STATUSES: OnboardingJobStatus[] = [
  "pending",
  "scraping",
  "sources_ready",
  "confirming",
];

export async function getOnboardingJobsKpis(): Promise<OnboardingJobsKpis> {
  const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      status: onboardingJobs.status,
      count: sql<number>`count(*)::int`,
    })
    .from(onboardingJobs)
    .where(gte(onboardingJobs.createdAt, last24h))
    .groupBy(onboardingJobs.status);

  const by_status: Record<OnboardingJobStatus, number> = {
    pending: 0,
    scraping: 0,
    sources_ready: 0,
    ready: 0,
    confirming: 0,
    done: 0,
    failed: 0,
  };
  for (const r of rows) {
    if (r.status in by_status) {
      by_status[r.status as OnboardingJobStatus] = Number(r.count);
    }
  }

  const active_count = ACTIVE_STATUSES.reduce((acc, s) => acc + by_status[s], 0);
  const failed_24h = by_status.failed;

  return { by_status, active_count, failed_24h };
}

// ─── Instance rows (JOIN con tiers calculados + msg_hoy agregado) ─────

export type InstanceTier = "fresh" | "early" | "mid" | "mature";

export type InstanceRow = {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  provider: "whapi" | "meta" | "twilio" | "evolution";
  instanceCreatedAt: Date;
  ageDays: number;
  tier: InstanceTier;
  cap: number | null;
  msgHoy: number;
  burned: boolean;
  burnedAt: Date | null;
  burnedReason: string | null;
  warmupOverride: boolean;
  warmupOverrideReason: string | null;
  warmupOverrideAt: Date | null;
};

export async function getInstanceRows(opts: {
  tierFilter?: InstanceTier;
  burnedOnly?: boolean;
  limit?: number;
  offset?: number;
} = {}): Promise<InstanceRow[]> {
  const limit = opts.limit ?? 100;
  const offset = opts.offset ?? 0;
  const tierParam = opts.tierFilter ?? null;
  const burnedParam = opts.burnedOnly === undefined ? null : opts.burnedOnly;

  // SQL único con LEFT JOIN agregado para evitar N+1.
  // SARGable: usamos date_trunc en lugar de cast ::date para que el índice
  // idx_msg_tenant(tenant_id, created_at) sirva el range scan.
  const result = await db.execute(sql`
    SELECT
      t.id AS tenant_id,
      t.slug AS tenant_slug,
      t.name AS tenant_name,
      pc.provider,
      pc.instance_created_at,
      EXTRACT(DAY FROM (now() - pc.instance_created_at))::int AS age_days,
      CASE
        WHEN pc.provider <> 'evolution' THEN 'mature'
        WHEN EXTRACT(DAY FROM (now() - pc.instance_created_at))::int <= 3 THEN 'fresh'
        WHEN EXTRACT(DAY FROM (now() - pc.instance_created_at))::int <= 7 THEN 'early'
        WHEN EXTRACT(DAY FROM (now() - pc.instance_created_at))::int <= 14 THEN 'mid'
        ELSE 'mature'
      END AS tier,
      CASE
        WHEN pc.provider <> 'evolution' THEN NULL
        WHEN EXTRACT(DAY FROM (now() - pc.instance_created_at))::int <= 3 THEN 30
        WHEN EXTRACT(DAY FROM (now() - pc.instance_created_at))::int <= 7 THEN 100
        WHEN EXTRACT(DAY FROM (now() - pc.instance_created_at))::int <= 14 THEN 300
        ELSE NULL
      END AS cap,
      COALESCE(m.count_hoy, 0) AS msg_hoy,
      pc.burned,
      pc.burned_at,
      pc.burned_reason,
      pc.warmup_override,
      pc.warmup_override_reason,
      pc.warmup_override_at
    FROM provider_credentials pc
    INNER JOIN tenants t ON t.id = pc.tenant_id
    LEFT JOIN (
      SELECT tenant_id, COUNT(*)::int AS count_hoy
      FROM messages
      WHERE role = 'assistant'
        AND created_at >= date_trunc('day', now())
        AND created_at <  date_trunc('day', now()) + interval '1 day'
      GROUP BY tenant_id
    ) m ON m.tenant_id = pc.tenant_id
    WHERE (${tierParam}::text IS NULL OR (
      CASE
        WHEN pc.provider <> 'evolution' THEN 'mature'
        WHEN EXTRACT(DAY FROM (now() - pc.instance_created_at))::int <= 3 THEN 'fresh'
        WHEN EXTRACT(DAY FROM (now() - pc.instance_created_at))::int <= 7 THEN 'early'
        WHEN EXTRACT(DAY FROM (now() - pc.instance_created_at))::int <= 14 THEN 'mid'
        ELSE 'mature'
      END = ${tierParam}::text
    ))
      AND (${burnedParam}::boolean IS NULL OR pc.burned = ${burnedParam}::boolean)
    ORDER BY pc.burned DESC, pc.instance_created_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `);

  // neon-http devuelve { rows } o array según versión. Normalizar.
  const rows = (Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? []) as Array<
    Record<string, unknown>
  >;

  return rows.map((r) => ({
    tenantId: String(r.tenant_id),
    tenantSlug: String(r.tenant_slug),
    tenantName: String(r.tenant_name),
    provider: r.provider as InstanceRow["provider"],
    instanceCreatedAt: new Date(String(r.instance_created_at)),
    ageDays: Number(r.age_days),
    tier: r.tier as InstanceTier,
    cap: r.cap === null ? null : Number(r.cap),
    msgHoy: Number(r.msg_hoy ?? 0),
    burned: Boolean(r.burned),
    burnedAt: r.burned_at ? new Date(String(r.burned_at)) : null,
    burnedReason: r.burned_reason ? String(r.burned_reason) : null,
    warmupOverride: Boolean(r.warmup_override),
    warmupOverrideReason: r.warmup_override_reason ? String(r.warmup_override_reason) : null,
    warmupOverrideAt: r.warmup_override_at ? new Date(String(r.warmup_override_at)) : null,
  }));
}

// ─── Instances KPIs ────────────────────────────────────────

export type InstancesKpis = {
  burnedCount: number;
  warmupInCurso: number;
};

export async function getInstancesKpis(): Promise<InstancesKpis> {
  const [burnedRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(providerCredentials)
    .where(eq(providerCredentials.burned, true));

  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const [warmupRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(providerCredentials)
    .where(
      and(
        eq(providerCredentials.provider, "evolution"),
        eq(providerCredentials.burned, false),
        gte(providerCredentials.instanceCreatedAt, fourteenDaysAgo),
      ),
    );

  return {
    burnedCount: Number(burnedRow?.n ?? 0),
    warmupInCurso: Number(warmupRow?.n ?? 0),
  };
}
