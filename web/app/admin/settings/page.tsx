import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { platformSettings } from "@/lib/db/schema";
import { SettingsForm } from "./form";

export default async function AdminSettingsPage() {
  const session = await auth();
  if (!session) redirect("/signin?from=/admin/settings");
  if (session.user.role !== "super_admin") redirect("/dashboard");

  const rows = await db.select().from(platformSettings);
  const populated: Record<string, boolean> = {};
  for (const r of rows) populated[r.key] = !!r.valueEncrypted;

  return (
    <AppShell session={session}>
      <h1 className="text-3xl font-semibold text-neutral-900">API keys globales</h1>
      <p className="mt-1 text-neutral-500">
        Se guardan cifradas con AES-256-GCM y solo tú puedes verlas. Si un tenant no trae su propia
        clave, se usa la global.
      </p>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Claves</CardTitle>
          <CardDescription>
            Solo los campos que actualices se sobreescriben. Deja en blanco los que no quieras tocar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SettingsForm populated={populated} descriptions={Object.fromEntries(rows.map((r) => [r.key, r.description ?? ""]))} />
        </CardContent>
      </Card>
    </AppShell>
  );
}
