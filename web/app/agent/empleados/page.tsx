// web/app/agent/empleados/page.tsx
//
// Owner gestiona empleados (meseros) con login PIN para el comandero.

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { AppShell } from "@/components/app-shell";
import { auth } from "@/lib/auth";
import { requireTenant } from "@/lib/tenant";
import { db } from "@/lib/db";
import { employees, tenants } from "@/lib/db/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmployeesManage } from "./employees-manage";

export const metadata = { title: "Empleados · Ordy Chat" };
export const dynamic = "force-dynamic";

export default async function EmpleadosPage() {
  const session = await auth();
  if (!session) redirect("/signin?from=/agent/empleados");
  const bundle = await requireTenant();
  if (!bundle) redirect("/onboarding");

  const rows = await db
    .select({
      id: employees.id,
      name: employees.name,
      role: employees.role,
      active: employees.active,
      lastLoginAt: employees.lastLoginAt,
      createdAt: employees.createdAt,
    })
    .from(employees)
    .where(eq(employees.tenantId, bundle.tenant.id))
    .orderBy(employees.name);

  const [tenant] = await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, bundle.tenant.id))
    .limit(1);

  const tabletUrl = tenant?.slug ? `/c/${tenant.slug}` : null;

  return (
    <AppShell
      session={session}
      subscriptionStatus={bundle.tenant.subscriptionStatus}
      trialDaysLeft={bundle.trialDaysLeft}
    >
      <main className="mx-auto max-w-3xl px-6 py-8">
        <h1 className="text-3xl font-semibold text-neutral-900">Empleados</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Cada empleado entra al comandero con su PIN de 4-6 dígitos. Manager
          puede gestionar empleados; waiter solo toma pedidos.
        </p>

        {tabletUrl ? (
          <Card className="mt-6 border-emerald-200 bg-emerald-50">
            <CardHeader>
              <CardTitle>Modo tablet</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-neutral-700">
                Abre esta URL en el iPad/Android del mostrador. Cada empleado
                entra con su PIN — sesión válida 12 h.
              </p>
              <code className="mt-3 block rounded-lg bg-white px-3 py-2 font-mono text-sm text-neutral-900">
                {typeof window === "undefined"
                  ? `https://ordychat.ordysuite.com${tabletUrl}`
                  : `${window.location.origin}${tabletUrl}`}
              </code>
            </CardContent>
          </Card>
        ) : null}

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>{rows.length} empleado{rows.length !== 1 ? "s" : ""}</CardTitle>
          </CardHeader>
          <CardContent>
            <EmployeesManage initialEmployees={rows} />
          </CardContent>
        </Card>
      </main>
    </AppShell>
  );
}
