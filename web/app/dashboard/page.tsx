import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import { ArrowRight, ChefHat, MessageSquareText, Smile, Sparkles, TrendingUp } from "lucide-react";
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
import { conversations, messages, orders, providerCredentials } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";

export default async function DashboardPage() {
  const session = await auth();
  if (!session) redirect("/signin?from=/dashboard");

  const bundle = await requireTenant();
  if (!bundle) redirect("/onboarding");

  if (!bundle.config?.onboardingCompleted) {
    redirect("/onboarding");
  }

  // KPIs all-time
  const [convCount] = await db
    .select({ n: count() })
    .from(conversations)
    .where(eq(conversations.tenantId, bundle.tenant.id));

  const [msgCount] = await db
    .select({ n: count() })
    .from(messages)
    .where(eq(messages.tenantId, bundle.tenant.id));

  // KPIs últimas 24h — vista operativa (lo que importa hoy)
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [msg24h] = await db
    .select({ n: count() })
    .from(messages)
    .where(and(eq(messages.tenantId, bundle.tenant.id), gte(messages.createdAt, since24h)));

  // Pedidos hoy + revenue hoy (descontando cancelados/test)
  const sinceToday = new Date();
  sinceToday.setHours(0, 0, 0, 0);
  const [ordersToday] = await db
    .select({
      n: count(),
      revenue: sql<number>`COALESCE(SUM(CASE WHEN ${orders.status} != 'cancelled' AND ${orders.isTest} = false THEN ${orders.totalCents} ELSE 0 END), 0)::int`,
    })
    .from(orders)
    .where(and(eq(orders.tenantId, bundle.tenant.id), gte(orders.createdAt, sinceToday)));

  const recent = await db
    .select()
    .from(conversations)
    .where(eq(conversations.tenantId, bundle.tenant.id))
    .orderBy(desc(conversations.lastMessageAt))
    .limit(6);

  const [creds] = await db
    .select({ provider: providerCredentials.provider })
    .from(providerCredentials)
    .where(eq(providerCredentials.tenantId, bundle.tenant.id))
    .limit(1);
  const usesEvolution = creds?.provider === "evolution";

  const isPaused = bundle.config?.paused ?? false;
  const formatEur = (cents: number) =>
    `${(cents / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}€`;

  function timeAgo(date: Date): string {
    const diff = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
    if (diff < 60) return "ahora";
    if (diff < 3600) return `hace ${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `hace ${Math.floor(diff / 3600)}h`;
    if (diff < 604800) return `hace ${Math.floor(diff / 86400)}d`;
    return new Date(date).toLocaleDateString("es-ES");
  }

  return (
    <AppShell session={session} subscriptionStatus={bundle.tenant.subscriptionStatus} trialDaysLeft={bundle.trialDaysLeft}>
      <PullToRefresh>
      <div className="space-y-8">
        <PageHeader
          title={`Hola, ${bundle.tenant.name}`}
          subtitle="Resumen operativo del día y actividad reciente."
        />

        {/* HERO STATS — 4 cards con número grande + meta + delta */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <HeroStat
            icon={<TrendingUp className="h-4 w-4" />}
            label="Ventas hoy"
            value={formatEur(ordersToday?.revenue ?? 0)}
            sub={`${ordersToday?.n ?? 0} pedido${ordersToday?.n === 1 ? "" : "s"}`}
            tone="emerald"
          />
          <HeroStat
            icon={<MessageSquareText className="h-4 w-4" />}
            label="Mensajes 24h"
            value={(msg24h?.n ?? 0).toLocaleString("es-ES")}
            sub={`${(msgCount?.n ?? 0).toLocaleString("es-ES")} totales`}
            tone="sky"
          />
          <HeroStat
            icon={<ChefHat className="h-4 w-4" />}
            label="Conversaciones"
            value={(convCount?.n ?? 0).toLocaleString("es-ES")}
            sub="acumulado"
            tone="violet"
          />
          <HeroStat
            icon={isPaused ? <Smile className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
            label="Estado del agente"
            value={isPaused ? "Pausado" : "Activo"}
            sub={isPaused ? "no responde" : "respondiendo"}
            tone={isPaused ? "amber" : "emerald"}
            valueClassName="text-2xl"
          />
        </div>

        {usesEvolution && <WhatsappConnection />}

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>Conversaciones recientes</CardTitle>
                <CardDescription>Las últimas 6 conversaciones de tus clientes.</CardDescription>
              </div>
              <Button asChild variant="ghost" size="sm">
                <Link href="/conversations" className="inline-flex items-center gap-1.5">
                  Ver todas <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
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
              <ul className="-mx-2 divide-y divide-black/5">
                {recent.map((c) => {
                  const initial = (c.customerName ?? c.phone ?? "?").trim().charAt(0).toUpperCase();
                  return (
                    <li key={c.id} className="flex items-center gap-3 rounded-lg px-2 py-3 transition hover:bg-stone-50">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-sm font-semibold text-white shadow-sm">
                        {initial}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-ink-900">
                          {c.customerName ?? c.phone}
                        </div>
                        <div className="truncate text-[12px] text-ink-500 tabular-nums">{c.phone}</div>
                      </div>
                      <div className="ml-4 shrink-0 text-right">
                        <div className="text-[11px] font-medium uppercase tracking-wider text-ink-400">
                          {timeAgo(c.lastMessageAt)}
                        </div>
                      </div>
                    </li>
                  );
                })}
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

// HeroStat — card con número grande tabular + label + sub + icon + tono.
// Inspirado en Bloomberg / Linear / Stripe dashboard.
function HeroStat({
  icon,
  label,
  value,
  sub,
  tone,
  valueClassName = "text-3xl",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  tone: "emerald" | "sky" | "violet" | "amber";
  valueClassName?: string;
}) {
  const tones: Record<typeof tone, { ring: string; iconBg: string; iconText: string }> = {
    emerald: { ring: "ring-emerald-100", iconBg: "bg-emerald-100", iconText: "text-emerald-700" },
    sky: { ring: "ring-sky-100", iconBg: "bg-sky-100", iconText: "text-sky-700" },
    violet: { ring: "ring-violet-100", iconBg: "bg-violet-100", iconText: "text-violet-700" },
    amber: { ring: "ring-amber-100", iconBg: "bg-amber-100", iconText: "text-amber-700" },
  };
  const t = tones[tone];
  return (
    <div className={`group rounded-2xl border border-black/5 bg-white p-5 shadow-sm ring-1 ${t.ring} transition hover:shadow-md`}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">
          {label}
        </div>
        <div className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${t.iconBg} ${t.iconText}`}>
          {icon}
        </div>
      </div>
      <div className={`mt-3 font-mono font-bold tabular-nums tracking-tight text-ink-900 ${valueClassName}`}>
        {value}
      </div>
      <div className="mt-0.5 text-[12px] text-ink-500">{sub}</div>
    </div>
  );
}
