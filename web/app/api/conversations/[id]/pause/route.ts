import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { conversations, pausedConversations } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";

// POST /api/conversations/[id]/pause
//
// Body (JSON):
//   { "action": "pause", "minutes"?: number }  → pausa bot minutos (default 1440=24h)
//   { "action": "unpause" }                     → borra fila de paused_conversations
//
// Autorización: usuario autenticado + conversación debe pertenecer a su tenant.
// El runtime (FastAPI) consulta paused_conversations antes de cada respuesta del
// bot; por eso el botón manual solo necesita escribir esta tabla.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauth" }, { status: 401 });
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "no tenant" }, { status: 404 });

  const { id } = await params;

  // Resuelve la conversación y valida ownership del tenant.
  const [conv] = await db
    .select({ id: conversations.id, phone: conversations.phone })
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.tenantId, bundle.tenant.id)))
    .limit(1);

  if (!conv) return NextResponse.json({ error: "not found" }, { status: 404 });

  let body: { action?: string; minutes?: number } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const action = body.action ?? "pause";

  if (action === "unpause") {
    await db
      .delete(pausedConversations)
      .where(
        and(
          eq(pausedConversations.tenantId, bundle.tenant.id),
          eq(pausedConversations.customerPhone, conv.phone),
        ),
      );
    return NextResponse.json({ ok: true, paused: false });
  }

  if (action !== "pause") {
    return NextResponse.json({ error: "invalid action" }, { status: 400 });
  }

  // Minutos válidos: 1..10080 (7 días). Default 1440 (24h).
  const minutosRaw = Number(body.minutes ?? 1440);
  const minutos = Number.isFinite(minutosRaw) && minutosRaw > 0
    ? Math.min(Math.floor(minutosRaw), 60 * 24 * 7)
    : 1440;

  // UPSERT: si ya hay pausa, extiende el pause_until.
  await db
    .insert(pausedConversations)
    .values({
      tenantId: bundle.tenant.id,
      customerPhone: conv.phone,
      reason: "manual_dashboard",
      pauseUntil: sql`now() + (${String(minutos)} || ' minutes')::interval`,
    })
    .onConflictDoUpdate({
      target: [pausedConversations.tenantId, pausedConversations.customerPhone],
      set: {
        pauseUntil: sql`now() + (${String(minutos)} || ' minutes')::interval`,
        pausedAt: sql`now()`,
        reason: "manual_dashboard",
      },
    });

  // Devuelve el pause_until calculado para que el cliente pueda mostrar countdown.
  const [row] = await db
    .select({ pauseUntil: pausedConversations.pauseUntil })
    .from(pausedConversations)
    .where(
      and(
        eq(pausedConversations.tenantId, bundle.tenant.id),
        eq(pausedConversations.customerPhone, conv.phone),
      ),
    )
    .limit(1);

  return NextResponse.json({
    ok: true,
    paused: true,
    pauseUntil: row?.pauseUntil ?? null,
    minutes: minutos,
  });
}
