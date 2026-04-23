// web/app/api/tenant/messages/poll/route.ts
//
// Poll de mensajes entrantes nuevos del tenant. Lo usa el NotificationBell
// del dashboard para sonar cuando llega un WA de un cliente. Devuelve
// conteo + previews cortas. No devuelve contenido completo — el UI
// detalle lo lee en /conversations.

import { and, desc, eq, gt } from "drizzle-orm";
import { NextResponse } from "next/server";
import { conversations, messages } from "@/lib/db/schema";
import { db } from "@/lib/db";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const url = new URL(req.url);
  const sinceRaw = url.searchParams.get("since");
  const since = sinceRaw ? new Date(sinceRaw) : new Date(Date.now() - 5 * 60_000);
  if (Number.isNaN(since.getTime())) {
    return NextResponse.json({ error: "bad_since" }, { status: 400 });
  }

  // Sólo mensajes entrantes (role='user') de este tenant, no playground,
  // posteriores a `since`. Top 5 para preview.
  const rows = await db
    .select({
      id: messages.id,
      conversationId: messages.conversationId,
      content: messages.content,
      createdAt: messages.createdAt,
      customerPhone: conversations.phone,
      customerName: conversations.customerName,
    })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(
      and(
        eq(messages.tenantId, bundle.tenant.id),
        eq(messages.role, "user"),
        eq(messages.isTest, false),
        gt(messages.createdAt, since),
      ),
    )
    .orderBy(desc(messages.createdAt))
    .limit(5);

  const latest = rows[0];
  return NextResponse.json({
    count: rows.length,
    latestCreatedAt: latest ? latest.createdAt.toISOString() : since.toISOString(),
    previews: rows.map((r) => ({
      id: String(r.id),
      conversationId: r.conversationId,
      from: r.customerName ?? r.customerPhone ?? "cliente",
      content: r.content.slice(0, 140),
      createdAt: r.createdAt.toISOString(),
    })),
  });
}
