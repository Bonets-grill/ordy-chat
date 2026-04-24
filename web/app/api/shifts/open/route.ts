// POST /api/shifts/open
// Abre un turno POS. Error 409 si ya hay uno abierto.
import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { shifts } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";

const bodySchema = z.object({
  openingCashCents: z.number().int().min(0).max(10_000_00).optional(), // 10.000€
  notes: z.string().max(500).optional(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauth" }, { status: 401 });
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "no tenant" }, { status: 404 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_input", issues: parsed.error.flatten() }, { status: 400 });
  }

  // Ya hay turno abierto?
  const [existing] = await db
    .select({ id: shifts.id })
    .from(shifts)
    .where(and(eq(shifts.tenantId, bundle.tenant.id), isNull(shifts.closedAt)))
    .limit(1);
  if (existing) {
    return NextResponse.json(
      { error: "shift_already_open", shiftId: existing.id },
      { status: 409 },
    );
  }

  const [row] = await db
    .insert(shifts)
    .values({
      tenantId: bundle.tenant.id,
      openedBy: session.user?.email ?? null,
      openingCashCents: parsed.data.openingCashCents ?? 0,
      notes: parsed.data.notes ?? null,
    })
    .returning();

  return NextResponse.json({ ok: true, shift: row });
}
