import { and, asc, eq, or, isNull, gt } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { MessageContent } from "@/components/message-content";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { conversations, messages, pausedConversations } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";
import { LiveRefresh } from "./live-refresh";
import { PauseBotButton } from "./pause-bot-button";

// force-dynamic: sin esto Next cachea el render y LiveRefresh no ve nuevos
// mensajes aunque haga router.refresh(). Con force-dynamic el re-render
// consulta la DB de verdad cada tick.
export const dynamic = "force-dynamic";

export default async function ConversationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) redirect("/signin?from=/conversations");
  const bundle = await requireTenant();
  if (!bundle) redirect("/onboarding");

  const { id } = await params;

  const [conv] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.tenantId, bundle.tenant.id)))
    .limit(1);

  if (!conv) notFound();

  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conv.id))
    .orderBy(asc(messages.createdAt));

  // Estado de pausa del bot para este teléfono. Activa si:
  //   - existe fila Y (pause_until IS NULL  ← pausa indefinida legacy)
  //   - o (pause_until > now())              ← pausa con expiración
  // Si la fila existe pero pause_until ya pasó, el runtime la ignora y aquí
  // la consideramos "no pausada" para que el botón vuelva a ofrecer pausar.
  const [pauseRow] = await db
    .select({
      pauseUntil: pausedConversations.pauseUntil,
    })
    .from(pausedConversations)
    .where(
      and(
        eq(pausedConversations.tenantId, bundle.tenant.id),
        eq(pausedConversations.customerPhone, conv.phone),
        or(isNull(pausedConversations.pauseUntil), gt(pausedConversations.pauseUntil, new Date())),
      ),
    )
    .limit(1);
  const paused = !!pauseRow;
  const pauseUntilIso = pauseRow?.pauseUntil ? pauseRow.pauseUntil.toISOString() : null;

  return (
    <AppShell session={session} subscriptionStatus={bundle.tenant.subscriptionStatus} trialDaysLeft={bundle.trialDaysLeft}>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Link href="/conversations" className="text-sm text-neutral-500 hover:text-neutral-900">← Todas las conversaciones</Link>
          <h1 className="mt-2 text-3xl font-semibold text-neutral-900">{conv.customerName ?? conv.phone}</h1>
          <p className="mt-1 text-neutral-500">{conv.phone} · {msgs.length} mensajes</p>
        </div>
        <div className="flex items-center gap-2">
          <PauseBotButton
            conversationId={conv.id}
            initialPaused={paused}
            initialPauseUntil={pauseUntilIso}
          />
          <LiveRefresh />
          <Badge tone="muted">Inicio: {new Date(conv.createdAt).toLocaleDateString("es-ES")}</Badge>
        </div>
      </div>

      <Card className="flex flex-col overflow-hidden" style={{ height: "calc(100vh - 16rem)" }}>
        <CardHeader className="flex-shrink-0 border-b border-neutral-100">
          <CardTitle>Historial</CardTitle>
        </CardHeader>
        <CardContent className="flex-1 overflow-y-auto overscroll-contain p-4">
          <div className="space-y-3">
            {msgs.map((m) => (
              <div key={m.id} className={`flex ${m.role === "assistant" ? "justify-start" : "justify-end"}`}>
                <div className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm ${
                  m.role === "assistant"
                    ? "bg-neutral-100 text-neutral-900"
                    : "bg-gradient-to-r from-brand-600 to-accent-pink text-white"
                }`}>
                  <MessageContent text={m.content} />
                  <div className={`mt-1 text-[10px] ${m.role === "assistant" ? "text-neutral-500" : "text-white/70"}`}>
                    {new Date(m.createdAt).toLocaleString("es-ES")}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </AppShell>
  );
}
