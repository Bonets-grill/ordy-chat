// web/app/admin/tenants/[id]/page.tsx — Detalle de un tenant (super admin).
// Sprint 3 validador-ui · Fase 9. CREADA de cero (no existía previamente).

import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AdminAuthError, requireSuperAdmin } from "@/lib/admin/auth";
import { getFlag } from "@/lib/admin/flags";
import { getRuns } from "@/lib/admin/validator-queries";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { agentConfigs, tenants } from "@/lib/db/schema";
import { ValidatorCard } from "./validator-card";

export const dynamic = "force-dynamic";

async function loadTenant(id: string) {
  const [row] = await db
    .select({
      id: tenants.id,
      slug: tenants.slug,
      name: tenants.name,
      subscriptionStatus: tenants.subscriptionStatus,
      createdAt: tenants.createdAt,
    })
    .from(tenants)
    .where(eq(tenants.id, id))
    .limit(1);
  return row ?? null;
}

async function loadAgent(tenantId: string) {
  const [row] = await db
    .select({
      validationMode: agentConfigs.validationMode,
      paused: agentConfigs.paused,
      agentName: agentConfigs.agentName,
    })
    .from(agentConfigs)
    .where(eq(agentConfigs.tenantId, tenantId))
    .limit(1);
  return row ?? null;
}

export default async function AdminTenantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  try {
    await requireSuperAdmin();
  } catch (err) {
    if (err instanceof AdminAuthError) {
      redirect(err.code === "UNAUTHENTICATED" ? "/signin?from=/admin/tenants" : "/dashboard");
    }
    throw err;
  }
  const session = await auth();
  if (!session) redirect("/signin?from=/admin/tenants");

  const { id } = await params;
  const tenant = await loadTenant(id);
  if (!tenant) notFound();

  const [agent, recentRuns, globalDefault] = await Promise.all([
    loadAgent(id),
    getRuns({ tenantSearch: tenant.slug, limit: 5, sinceHours: 720 }),
    getFlag<"auto" | "manual" | "skip">("validation_mode_default").catch(() => "skip" as const),
  ]);

  const effectiveMode: "auto" | "manual" | "skip" =
    agent?.validationMode === "auto" || agent?.validationMode === "manual" || agent?.validationMode === "skip"
      ? agent.validationMode
      : globalDefault;

  return (
    <AppShell session={session}>
      <div className="space-y-6">
        <div>
          <Link href="/admin/tenants" className="text-sm text-neutral-500 hover:text-neutral-900">
            ← Tenants
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {tenant.name}{" "}
            <span className="text-neutral-400 text-base font-normal">/{tenant.slug}</span>
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-neutral-500">
            <Badge tone="muted">plan: {tenant.subscriptionStatus}</Badge>
            {agent && (
              <Badge tone={agent.paused ? "warn" : "success"}>
                {agent.paused ? "agente pausado" : "agente activo"}
              </Badge>
            )}
            <span>·</span>
            <span>creado {new Date(tenant.createdAt).toLocaleDateString("es-ES")}</span>
          </div>
        </div>

        <ValidatorCard
          tenantId={tenant.id}
          override={(agent?.validationMode as "auto" | "manual" | "skip" | null) ?? null}
          globalDefault={globalDefault}
          effectiveMode={effectiveMode}
          paused={Boolean(agent?.paused)}
        />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Últimos runs validador</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-neutral-100">
              {recentRuns.length === 0 ? (
                <div className="p-4 text-sm text-neutral-500">Sin runs todavía.</div>
              ) : (
                recentRuns.map((r) => (
                  <Link
                    key={r.id}
                    href={`/admin/validator/${r.id}`}
                    className="flex items-center justify-between gap-3 p-3 hover:bg-neutral-50"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{r.status}</div>
                      <div className="text-xs text-neutral-500">
                        {r.triggeredBy} · {r.nicho} · {new Date(r.createdAt).toLocaleString("es-ES")}
                      </div>
                    </div>
                    <div className="text-xs text-neutral-500 tabular-nums">
                      {r.summary
                        ? `${r.summary.passed}/${r.summary.total}`
                        : "—"}
                    </div>
                  </Link>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
