import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { agentConfigs, tenants, users } from "@/lib/db/schema";

export default async function AdminTenantsPage() {
  const session = await auth();
  if (!session) redirect("/signin?from=/admin/tenants");
  if (session.user.role !== "super_admin") redirect("/dashboard");

  const rows = await db
    .select({ tenant: tenants, owner: users, config: agentConfigs })
    .from(tenants)
    .leftJoin(users, eq(users.id, tenants.ownerUserId))
    .leftJoin(agentConfigs, eq(agentConfigs.tenantId, tenants.id))
    .orderBy(desc(tenants.createdAt))
    .limit(200);

  return (
    <AdminShell session={session}>
      <h1 className="text-3xl font-semibold text-neutral-900">Tenants</h1>
      <p className="mt-1 text-neutral-500">Todos los clientes de la plataforma.</p>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{rows.length} tenants</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-100 text-left text-xs uppercase text-neutral-500">
                <th className="py-2">Slug</th>
                <th>Negocio</th>
                <th>Owner</th>
                <th>Estado</th>
                <th>Agente</th>
                <th>Onboarding</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ tenant, owner, config }) => (
                <tr key={tenant.id} className="border-b border-neutral-50 last:border-0">
                  <td className="py-2 font-mono text-xs text-brand-600">{tenant.slug}</td>
                  <td>{tenant.name}</td>
                  <td className="text-xs text-neutral-500">{owner?.email ?? "—"}</td>
                  <td><Badge tone={tenant.subscriptionStatus === "active" ? "success" : "warn"}>{tenant.subscriptionStatus}</Badge></td>
                  <td className="text-xs">{config?.paused ? "⏸ Pausado" : "▶ Activo"}</td>
                  <td className="text-xs">{config?.onboardingCompleted ? "✅" : "⏳"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </AdminShell>
  );
}
