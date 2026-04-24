import { and, desc, eq } from "drizzle-orm";
import { MessageSquareText } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { conversations, messages } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ includeTest?: string }>;
}) {
  const session = await auth();
  if (!session) redirect("/signin?from=/conversations");
  const bundle = await requireTenant();
  if (!bundle) redirect("/onboarding");

  // Mig 029: ocultamos conversaciones de playground (is_test=true) por defecto.
  // Toggle "🧪 Incluir pruebas" añade ?includeTest=1.
  const sp = await searchParams;
  const includeTest = sp.includeTest === "1";

  const rows = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.tenantId, bundle.tenant.id),
        ...(includeTest ? [] : [eq(conversations.isTest, false)]),
      ),
    )
    .orderBy(desc(conversations.lastMessageAt))
    .limit(50);

  const lastMsgs = await Promise.all(
    rows.map(async (c) => {
      const [m] = await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, c.id))
        .orderBy(desc(messages.createdAt))
        .limit(1);
      return { conv: c, last: m };
    }),
  );

  return (
    <AppShell session={session} subscriptionStatus={bundle.tenant.subscriptionStatus} trialDaysLeft={bundle.trialDaysLeft}>
      <PageHeader
        title="Conversaciones"
        subtitle="Últimas 50 conversaciones de tu agente."
        actions={
          <>
            <Link
              href={includeTest ? "/conversations" : "/conversations?includeTest=1"}
              className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium transition-colors ${
                includeTest
                  ? "bg-warn-50 text-warn-800 hover:bg-warn-100"
                  : "bg-black/[0.04] text-ink-700 hover:bg-black/[0.08]"
              }`}
            >
              {includeTest ? "🧪 Mostrando pruebas" : "🧪 Incluir pruebas"}
            </Link>
            <Button asChild variant="secondary" size="sm">
              <a href="/api/conversations/export" download>Exportar CSV</a>
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Historial</CardTitle>
        </CardHeader>
        <CardContent>
          {lastMsgs.length === 0 ? (
            <EmptyState
              icon={MessageSquareText}
              title="Todavía no hay conversaciones"
              description="Cuando un cliente escriba a tu WhatsApp, aparecerá aquí."
            />
          ) : (
            <ul className="divide-y divide-black/5">
              {lastMsgs.map(({ conv, last }) => (
                <li key={conv.id} className="py-3">
                  <Link
                    href={`/conversations/${conv.id}`}
                    className="group -mx-2 block rounded-lg px-2 py-1 transition-colors hover:bg-black/[0.03]"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="truncate font-medium text-ink-900 group-hover:text-brand-600">
                        {conv.customerName ?? conv.phone}
                      </div>
                      <div className="shrink-0 text-[12px] text-ink-500 tabular-nums">
                        {new Date(conv.lastMessageAt).toLocaleString("es-ES")}
                      </div>
                    </div>
                    {last && (
                      <div className="mt-1 line-clamp-2 text-[13.5px] text-ink-500">
                        {last.role === "assistant" ? "🤖 " : "👤 "}
                        {last.content}
                      </div>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
