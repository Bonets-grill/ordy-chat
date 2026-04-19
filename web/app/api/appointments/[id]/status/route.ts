// web/app/api/appointments/[id]/status/route.ts
// POST { status: "confirmed" | "completed" | "cancelled" } — cambia estado
// de una cita. Valida ownership tenant antes de UPDATE. Transiciones válidas:
// pending → confirmed → completed; pending|confirmed → cancelled (terminal).

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { appointments } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";

const ALLOWED = new Set(["confirmed", "completed", "cancelled"]);

const TRANSITIONS: Record<string, Set<string>> = {
  pending: new Set(["confirmed", "cancelled"]),
  confirmed: new Set(["completed", "cancelled"]),
  completed: new Set([]),
  cancelled: new Set([]),
};

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const bundle = await requireTenant();
  if (!bundle) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { status?: string };
  const nextStatus = body.status;

  if (!nextStatus || !ALLOWED.has(nextStatus)) {
    return NextResponse.json({ error: "invalid_status" }, { status: 400 });
  }

  const [current] = await db
    .select()
    .from(appointments)
    .where(and(eq(appointments.id, id), eq(appointments.tenantId, bundle.tenant.id)))
    .limit(1);

  if (!current) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const allowedNext = TRANSITIONS[current.status] ?? new Set<string>();
  if (!allowedNext.has(nextStatus)) {
    return NextResponse.json(
      { error: "invalid_transition", from: current.status, to: nextStatus },
      { status: 409 },
    );
  }

  await db
    .update(appointments)
    .set({ status: nextStatus, updatedAt: new Date() })
    .where(eq(appointments.id, id));

  return NextResponse.json({ ok: true, id, status: nextStatus });
}
