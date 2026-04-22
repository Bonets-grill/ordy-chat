import { and, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-neutral-900">Conversaciones</h1>
          <p className="mt-1 text-neutral-500">Últimas 50 conversaciones de tu agente.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={includeTest ? "/conversations" : "/conversations?includeTest=1"}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
              includeTest
                ? "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
                : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"
            }`}
          >
            {includeTest ? "🧪 Mostrando pruebas" : "🧪 Incluir pruebas"}
          </Link>
          <Button asChild variant="secondary">
            <a href="/api/conversations/export" download>Exportar CSV</a>
          </Button>
        </div>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Historial</CardTitle>
        </CardHeader>
        <CardContent>
          {lastMsgs.length === 0 ? (
            <p className="text-sm text-neutral-500">Todavía no hay conversaciones.</p>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {lastMsgs.map(({ conv, last }) => (
                <li key={conv.id} className="py-3">
                  <Link href={`/conversations/${conv.id}`} className="group block rounded-lg -mx-2 px-2 py-1 hover:bg-neutral-50">
                    <div className="flex items-center justify-between">
                      <div className="font-medium text-neutral-900 group-hover:text-brand-600">{conv.customerName ?? conv.phone}</div>
                      <div className="text-xs text-neutral-500">{new Date(conv.lastMessageAt).toLocaleString("es-ES")}</div>
                    </div>
                    {last && <div className="mt-1 line-clamp-2 text-sm text-neutral-600">{last.role === "assistant" ? "🤖 " : "👤 "}{last.content}</div>}
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
