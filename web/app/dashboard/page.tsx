import { count, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { PullToRefresh } from "@/components/pull-to-refresh";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { WhatsappConnection } from "@/components/whatsapp-connection";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { conversations, messages, providerCredentials } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";

export default async function DashboardPage() {
  const session = await auth();
  if (!session) redirect("/signin?from=/dashboard");

  const bundle = await requireTenant();
  if (!bundle) redirect("/onboarding");

  if (!bundle.config?.onboardingCompleted) {
    redirect("/onboarding");
  }

  const [convCount] = await db
    .select({ n: count() })
    .from(conversations)
    .where(eq(conversations.tenantId, bundle.tenant.id));

  const [msgCount] = await db
    .select({ n: count() })
    .from(messages)
    .where(eq(messages.tenantId, bundle.tenant.id));

  const recent = await db
    .select()
    .from(conversations)
    .where(eq(conversations.tenantId, bundle.tenant.id))
    .orderBy(desc(conversations.lastMessageAt))
    .limit(5);

  const [creds] = await db
    .select({ provider: providerCredentials.provider })
    .from(providerCredentials)
    .where(eq(providerCredentials.tenantId, bundle.tenant.id))
    .limit(1);
  const usesEvolution = creds?.provider === "evolution";

  return (
    <AppShell session={session} subscriptionStatus={bundle.tenant.subscriptionStatus} trialDaysLeft={bundle.trialDaysLeft}>
      <PullToRefresh>
      <div className="space-y-8">
        <header>
          <h1 className="text-3xl font-semibold text-neutral-900">Hola, {bundle.tenant.name}</h1>
          <p className="mt-1 text-neutral-500">Aquí tienes un resumen de la actividad de tu agente.</p>
        </header>

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardDescription>Conversaciones</CardDescription>
              <CardTitle className="text-3xl">{convCount?.n ?? 0}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Mensajes totales</CardDescription>
              <CardTitle className="text-3xl">{msgCount?.n ?? 0}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Estado del agente</CardDescription>
              <CardTitle className="text-3xl">{bundle.config?.paused ? "Pausado" : "Activo"}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        {usesEvolution && <WhatsappConnection />}

        <Card>
          <CardHeader>
            <CardTitle>Conversaciones recientes</CardTitle>
            <CardDescription>Las últimas 5 conversaciones de tus clientes.</CardDescription>
          </CardHeader>
          <CardContent>
            {recent.length === 0 ? (
              <p className="text-sm text-neutral-500">
                Aún no tienes conversaciones. Conecta tu WhatsApp en{" "}
                <Link href="/agent" className="font-medium text-brand-600 hover:underline">Mi agente</Link>.
              </p>
            ) : (
              <ul className="divide-y divide-neutral-100">
                {recent.map((c) => (
                  <li key={c.id} className="flex items-center justify-between py-3">
                    <div>
                      <div className="font-medium text-neutral-900">{c.customerName ?? c.phone}</div>
                      <div className="text-xs text-neutral-500">{c.phone}</div>
                    </div>
                    <div className="text-xs text-neutral-500">
                      {new Date(c.lastMessageAt).toLocaleString("es-ES")}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button asChild variant="brand">
            <Link href="/conversations">Ver todas las conversaciones</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href="/agent">Editar mi agente</Link>
          </Button>
          <Button asChild variant="ghost">
            <a href="/api/conversations/export" download>Exportar CSV</a>
          </Button>
        </div>
      </div>
      </PullToRefresh>
    </AppShell>
  );
}
