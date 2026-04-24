import { count, desc, eq } from "drizzle-orm";
import { MessageSquareText } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell, PageHeader } from "@/components/app-shell";
import { PullToRefresh } from "@/components/pull-to-refresh";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
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
        <PageHeader
          title={`Hola, ${bundle.tenant.name}`}
          subtitle="Resumen de la actividad de tu agente."
        />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardDescription>Conversaciones</CardDescription>
              <CardTitle className="text-[28px] tabular-nums text-ink-900">{convCount?.n ?? 0}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Mensajes totales</CardDescription>
              <CardTitle className="text-[28px] tabular-nums text-ink-900">{msgCount?.n ?? 0}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Estado del agente</CardDescription>
              <CardTitle className="text-[28px] text-ink-900">{bundle.config?.paused ? "Pausado" : "Activo"}</CardTitle>
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
              <EmptyState
                icon={MessageSquareText}
                title="Aún no hay conversaciones"
                description="Conecta tu WhatsApp en Mi agente para empezar a recibir mensajes."
                action={
                  <Button asChild variant="brand" size="sm">
                    <Link href="/agent">Conectar WhatsApp</Link>
                  </Button>
                }
              />
            ) : (
              <ul className="divide-y divide-black/5">
                {recent.map((c) => (
                  <li key={c.id} className="flex items-center justify-between py-3">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-ink-900">{c.customerName ?? c.phone}</div>
                      <div className="text-[12px] text-ink-500 tabular-nums">{c.phone}</div>
                    </div>
                    <div className="ml-4 shrink-0 text-[12px] text-ink-500 tabular-nums">
                      {new Date(c.lastMessageAt).toLocaleString("es-ES")}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-wrap gap-2">
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
