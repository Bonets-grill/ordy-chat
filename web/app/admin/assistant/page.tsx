// web/app/admin/assistant/page.tsx — Chat super admin con Claude Opus 4.7.
// Server component que renderiza el shell + monta el client component del chat.

import { AdminShell } from "@/components/admin-shell";
import { AdminAuthError, requireSuperAdmin } from "@/lib/admin/auth";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { AssistantChat } from "./chat";

export const dynamic = "force-dynamic";

export default async function AdminAssistantPage() {
  try {
    await requireSuperAdmin();
  } catch (e) {
    if (e instanceof AdminAuthError) {
      if (e.code === "UNAUTHENTICATED") redirect("/signin?from=/admin/assistant");
      redirect("/dashboard");
    }
    throw e;
  }
  const session = await auth();
  if (!session) redirect("/signin?from=/admin/assistant");

  return (
    <AdminShell session={session}>
      <div className="mx-auto max-w-3xl">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-neutral-900">Asistente</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Chat directo con Claude Opus 4.7. Tiene acceso READ al estado del sistema
            (tenants, runs del validador, flags). Advisory-only: no ejecuta cambios.
          </p>
        </header>
        <AssistantChat />
      </div>
    </AdminShell>
  );
}
