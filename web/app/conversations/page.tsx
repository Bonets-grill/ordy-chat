import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { conversations, messages } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";

export default async function ConversationsPage() {
  const session = await auth();
  if (!session) redirect("/signin?from=/conversations");
  const bundle = await requireTenant();
  if (!bundle) redirect("/onboarding");

  const rows = await db
    .select()
    .from(conversations)
    .where(eq(conversations.tenantId, bundle.tenant.id))
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
        <Button asChild variant="secondary">
          <a href="/api/conversations/export" download>Exportar CSV</a>
        </Button>
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
