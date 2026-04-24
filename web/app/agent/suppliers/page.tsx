import { asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { nonCustomerContacts } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";
import { SuppliersEditor } from "./suppliers-editor";

export const dynamic = "force-dynamic";

export default async function SuppliersPage() {
  const session = await auth();
  if (!session) redirect("/signin?from=/agent/suppliers");
  const bundle = await requireTenant();
  if (!bundle) redirect("/onboarding");

  const rows = await db
    .select()
    .from(nonCustomerContacts)
    .where(eq(nonCustomerContacts.tenantId, bundle.tenant.id))
    .orderBy(asc(nonCustomerContacts.label));

  return (
    <AppShell
      session={session}
      subscriptionStatus={bundle.tenant.subscriptionStatus}
      trialDaysLeft={bundle.trialDaysLeft}
    >
      <div className="mx-auto max-w-3xl">
        <header className="mb-6">
          <h1 className="text-3xl font-semibold text-neutral-900">Proveedores y contactos</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Números de WhatsApp que NO son clientes — proveedores, comerciales, o cualquier
            otro. Cuando uno de estos escriba al bot, el agente no responderá y te avisará
            directamente a ti por WhatsApp.
          </p>
        </header>
        <SuppliersEditor
          initial={rows.map((r) => ({
            id: r.id,
            phone: r.phone,
            label: r.label,
            kind: r.kind,
            notes: r.notes,
          }))}
        />
      </div>
    </AppShell>
  );
}
