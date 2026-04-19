// web/app/admin/flags/page.tsx — Gestión de feature flags (super admin).

import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminShell } from "@/components/admin-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AdminAuthError, requireSuperAdmin } from "@/lib/admin/auth";
import { listFlagStates } from "@/lib/admin/flags";
import { auth } from "@/lib/auth";
import { FlagForm, type FlagState } from "./flag-form";

export const dynamic = "force-dynamic";

export default async function AdminFlagsPage() {
  try {
    await requireSuperAdmin();
  } catch (err) {
    if (err instanceof AdminAuthError) {
      redirect(err.code === "UNAUTHENTICATED" ? "/signin?from=/admin/flags" : "/dashboard");
    }
    throw err;
  }

  const session = await auth();
  if (!session) redirect("/signin?from=/admin/flags"); // narrow para AppShell (requireSuperAdmin ya garantiza, defensivo)
  const states = await listFlagStates();

  return (
    <AdminShell session={session}>
      <div className="space-y-6">
        <header>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-semibold text-neutral-900">Feature flags</h1>
          </div>
          <p className="mt-1 text-neutral-500">
            Toggles globales sin redeploy. Precedencia: <strong>DB override</strong> &gt;{" "}
            <strong>ENV var</strong> &gt; <strong>default</strong>.
          </p>
          <div className="mt-3 text-sm">
            <Link className="text-neutral-600 underline" href="/admin">
              ← Volver al panel
            </Link>
          </div>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Flags</CardTitle>
            <CardDescription>
              Los cambios en DB sobrescriben cualquier valor de ENV. Cache server-process de 30s —
              el nuevo valor se propaga al instante en el proceso que guardó; otros procesos lo
              leen tras expirar el TTL.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {states.map((s) => (
              <FlagForm key={s.key} state={s as FlagState} />
            ))}
          </CardContent>
        </Card>
      </div>
    </AdminShell>
  );
}
