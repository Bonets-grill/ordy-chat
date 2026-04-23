// web/app/api/sessions/[id]/mark-paid/route.ts
//
// Fase 5 del plan de sesión de mesa: el camarero marca la mesa como pagada
// (efectivo o TPV físico) desde KDS o admin. Transiciona la table_session
// a 'paid' y marca todos los pedidos linkeados como paid.
//
// Auth: tenant session (Auth.js) o kiosk token (pantalla cocina pública).
// Solo el tenant dueño de la sesión puede marcarla.

import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditLog, orders, tableSessions } from "@/lib/db/schema";
import { requireTenantOrKiosk } from "@/lib/kiosk-auth";

export const runtime = "nodejs";

const paySchema = z.object({
  paymentMethod: z.enum(["cash", "card_terminal"]),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const bundle = await requireTenantOrKiosk(req);
  if (!bundle) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id: sessionId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) {
    return NextResponse.json({ error: "bad_session_id" }, { status: 400 });
  }

  const parsed = paySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "bad_input", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const [row] = await db
    .select({
      id: tableSessions.id,
      tenantId: tableSessions.tenantId,
      status: tableSessions.status,
      totalCents: tableSessions.totalCents,
    })
    .from(tableSessions)
    .where(
      and(
        eq(tableSessions.id, sessionId),
        eq(tableSessions.tenantId, bundle.tenant.id),
      ),
    )
    .limit(1);
  if (!row) return NextResponse.json({ error: "session_not_found" }, { status: 404 });
  if (row.status === "paid" || row.status === "closed") {
    return NextResponse.json(
      { error: "already_paid_or_closed", status: row.status },
      { status: 409 },
    );
  }

  const now = new Date();
  const [updated] = await db
    .update(tableSessions)
    .set({
      status: "paid",
      paymentMethod: parsed.data.paymentMethod,
      paidAt: now,
      updatedAt: now,
    })
    .where(eq(tableSessions.id, row.id))
    .returning({ id: tableSessions.id, totalCents: tableSessions.totalCents });

  await db
    .update(orders)
    .set({ status: "paid", paidAt: now, updatedAt: now })
    .where(eq(orders.sessionId, row.id));

  // Audit log — userId solo cuando auth es tenant session (no kiosk).
  // En kiosk queda null (no hay login humano identificable).
  const session = await auth();
  const userId = session?.user?.id ?? null;
  await db.insert(auditLog).values({
    tenantId: bundle.tenant.id,
    userId,
    action: "tenant_mark_session_paid",
    entity: "table_sessions",
    entityId: row.id,
    metadata: {
      payment_method: parsed.data.paymentMethod,
      total_cents: row.totalCents,
      via: userId ? "web" : "kiosk",
    },
  });

  return NextResponse.json({
    ok: true,
    session: updated,
    paymentMethod: parsed.data.paymentMethod,
  });
}
