import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditLog, resellers } from "@/lib/db/schema";
import { limitByUserId } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const BODY = z.object({
  status: z.enum(["pending", "active", "paused", "terminated"]),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "super_admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await params;

  const rate = await limitByUserId(session.user.id, "reseller_approve", 30, "1 h");
  if (!rate.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const body = BODY.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: "invalid_body", issues: body.error.flatten() }, { status: 400 });
  }

  const [existing] = await db.select().from(resellers).where(eq(resellers.id, id)).limit(1);
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Gate: status='active' requiere stripe_connect_account_id (CHECK en DB).
  if (body.data.status === "active" && !existing.stripeConnectAccountId) {
    return NextResponse.json(
      { error: "Reseller no puede activarse sin Stripe Connect completado" },
      { status: 409 },
    );
  }

  await db.update(resellers).set({ status: body.data.status }).where(eq(resellers.id, id));

  await db.insert(auditLog).values({
    action: "admin.reseller.status_changed",
    entity: "reseller",
    entityId: id,
    userId: session.user.id,
    metadata: { from: existing.status, to: body.data.status },
  });

  return NextResponse.json({ ok: true, status: body.data.status });
}
