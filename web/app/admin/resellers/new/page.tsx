import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { NewResellerForm } from "./form";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function NewResellerPage() {
  const session = await auth();
  if (!session) redirect("/signin?from=/admin/resellers/new");
  if (session.user.role !== "super_admin") redirect("/dashboard");

  return (
    <AppShell session={session}>
      <h1 className="text-3xl font-semibold text-neutral-900">Nuevo reseller</h1>
      <p className="mt-1 text-neutral-500">
        Crea un partner que revenderá Ordy Chat con comisión recurrente.
      </p>

      <NewResellerForm actorUserId={session.user.id} />
    </AppShell>
  );
}
