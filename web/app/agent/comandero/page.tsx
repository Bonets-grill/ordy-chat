// web/app/agent/comandero/page.tsx
//
// Pantalla full-screen sin AppShell — el comandero corre como app dedicada
// para tablets en mostrador. Dos vistas según cookie:
//   1. Cookie empleado válida → ComanderoBoard con top-bar (nombre + logout).
//   2. Sesión owner válida    → ComanderoBoard mostrando "Owner" (útil para
//      configurar / probar sin crear empleados).
//   3. Nadie autenticado      → redirect a signin del owner.

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { requireTenant } from "@/lib/tenant";
import { getCurrentEmployee } from "@/lib/employees/auth";
import { db } from "@/lib/db";
import { tenants } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { ComanderoBoard } from "./comandero-board";

export const metadata = { title: "Comandero · Ordy Chat" };
export const dynamic = "force-dynamic";

export default async function ComanderoPage() {
  const employee = await getCurrentEmployee();
  if (employee) {
    return (
      <ComanderoBoard
        actor={{ kind: "employee", name: employee.name, role: employee.role }}
      />
    );
  }

  const session = await auth();
  if (session?.user?.id) {
    const bundle = await requireTenant();
    if (bundle) {
      const [t] = await db
        .select({ slug: tenants.slug })
        .from(tenants)
        .where(eq(tenants.id, bundle.tenant.id))
        .limit(1);
      return (
        <ComanderoBoard
          actor={{
            kind: "owner",
            name: session.user.name ?? session.user.email ?? "Owner",
            tenantSlug: t?.slug ?? null,
          }}
        />
      );
    }
    redirect("/onboarding");
  }

  redirect("/signin?from=/agent/comandero");
}
