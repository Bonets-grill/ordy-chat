import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TotpSetupForm } from "./totp-setup-form";

export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin?from=/agent/security");

  const [me] = await db
    .select({
      id: users.id,
      email: users.email,
      totpEnabledAt: users.totpEnabledAt,
    })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  if (!me) redirect("/signin");

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-3xl font-semibold text-neutral-900">Seguridad</h1>
      <p className="mt-1 text-neutral-500">
        Doble factor (TOTP) para operaciones sensibles como aprobar payouts.
      </p>

      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Autenticación de dos factores (2FA)</CardTitle>
        </CardHeader>
        <CardContent>
          <TotpSetupForm
            email={me.email}
            enabledAt={me.totpEnabledAt ? me.totpEnabledAt.toISOString() : null}
          />
        </CardContent>
      </Card>
    </main>
  );
}
