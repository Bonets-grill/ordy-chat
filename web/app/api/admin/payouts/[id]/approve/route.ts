// web/app/api/admin/payouts/[id]/approve/route.ts
// POST: Mario aprueba un payout 'ready' y ejecuta el transfer Stripe.
// Gate high-value: payouts >= HIGH_VALUE_PAYOUT_CENTS requieren confirm
// dual explícito (body.confirm_high_value = true + body.confirmation_text
// matching el id del payout). TOTP 2FA queda como TODO post-MVP — cuando
// Mario configure TOTP se añade aquí.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditLog, resellerPayouts } from "@/lib/db/schema";
import { limitByUserId } from "@/lib/rate-limit";
import { executeStripeTransfer, TransferError } from "@/lib/payouts/stripe-transfer";

export const dynamic = "force-dynamic";

const BODY = z.object({
  confirm_high_value: z.boolean().optional(),
  confirmation_text: z.string().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "super_admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await params;

  const rate = await limitByUserId(session.user.id, "payout_approve", 60, "1 h");
  if (!rate.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const body = BODY.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const [payout] = await db.select().from(resellerPayouts).where(eq(resellerPayouts.id, id)).limit(1);
  if (!payout) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (payout.status !== "ready") {
    return NextResponse.json(
      { error: "invalid_state", current: payout.status },
      { status: 409 },
    );
  }

  // High-value approval gate
  if (payout.requiresHighValueApproval) {
    if (!body.data.confirm_high_value) {
      return NextResponse.json(
        { error: "high_value_confirmation_required" },
        { status: 403 },
      );
    }
    if (body.data.confirmation_text !== payout.id) {
      return NextResponse.json(
        { error: "confirmation_text_must_match_payout_id" },
        { status: 403 },
      );
    }
  }

  try {
    const transferId = await executeStripeTransfer({ payoutId: payout.id });
    await db
      .update(resellerPayouts)
      .set({ approvedByUserId: session.user.id, approvedAt: new Date() })
      .where(eq(resellerPayouts.id, payout.id));
    await db.insert(auditLog).values({
      action: "admin.payout.approved",
      entity: "reseller_payout",
      entityId: payout.id,
      userId: session.user.id,
      metadata: {
        transfer_id: transferId,
        amount_cents:
          (payout.taxBreakdown as { transfer_cents?: number } | null)?.transfer_cents ??
          payout.sourceTotalCents,
        high_value: payout.requiresHighValueApproval,
      },
    });
    return NextResponse.json({ ok: true, transfer_id: transferId });
  } catch (err) {
    if (err instanceof TransferError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: 422 });
    }
    console.error("[payout.approve] unexpected:", err);
    return NextResponse.json({ error: "unexpected" }, { status: 500 });
  }
}
