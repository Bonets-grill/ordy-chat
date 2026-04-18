// web/lib/payouts/stripe-transfer.ts
// Ejecuta stripe.transfers.create para un payout 'ready' con KYC gate.

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { resellerPayouts, resellers } from "@/lib/db/schema";
import { stripeClient } from "@/lib/stripe";

export class TransferError extends Error {
  constructor(
    public code:
      | "payout_not_found"
      | "payout_wrong_state"
      | "reseller_not_found"
      | "connect_kyc_pending"
      | "connect_restricted"
      | "no_connect_account",
    message: string,
  ) {
    super(message);
    this.name = "TransferError";
  }
}

/**
 * Ejecuta el transfer Stripe y marca el payout como 'sent'.
 * Retorna el transfer_id. Si falla, el payout queda 'failed'.
 */
export async function executeStripeTransfer(args: {
  payoutId: string;
  attemptN?: number;
}): Promise<string> {
  const attemptN = args.attemptN ?? 1;

  const [payout] = await db
    .select()
    .from(resellerPayouts)
    .where(eq(resellerPayouts.id, args.payoutId))
    .limit(1);
  if (!payout) throw new TransferError("payout_not_found", `Payout ${args.payoutId} not found`);
  if (payout.status !== "ready") {
    throw new TransferError("payout_wrong_state", `Payout in state ${payout.status}, expected 'ready'`);
  }

  const [r] = await db
    .select()
    .from(resellers)
    .where(eq(resellers.id, payout.resellerId))
    .limit(1);
  if (!r) throw new TransferError("reseller_not_found", "Reseller disappeared mid-transfer");

  // KYC gate — defense in depth (el cron también debería filtrarlo, pero
  // confirmamos aquí antes de mover dinero).
  if (!r.stripeConnectAccountId) {
    throw new TransferError("no_connect_account", "Reseller has no Stripe Connect account");
  }
  if (!r.stripeConnectPayoutsEnabled) {
    throw new TransferError("connect_kyc_pending", "Reseller Connect payouts_enabled=false (KYC pending)");
  }
  if (r.stripeConnectStatus === "restricted" || r.stripeConnectStatus === "deauthorized") {
    throw new TransferError(
      "connect_restricted",
      `Reseller Connect status = ${r.stripeConnectStatus}`,
    );
  }

  const breakdown = payout.taxBreakdown as { transfer_cents?: number } | null;
  const amountCents = breakdown?.transfer_cents ?? payout.sourceTotalCents;
  if (amountCents <= 0) {
    // Debt mayor que source → nada que transferir. Marca payout canceled.
    await db
      .update(resellerPayouts)
      .set({ status: "canceled", notes: "transfer_amount_zero" })
      .where(eq(resellerPayouts.id, payout.id));
    throw new TransferError("payout_wrong_state", "Transfer amount is zero");
  }

  const stripe = await stripeClient();
  try {
    const transfer = await stripe.transfers.create(
      {
        amount: amountCents,
        currency: "eur", // Platform currency; Stripe convierte al llegar.
        destination: r.stripeConnectAccountId,
        transfer_group: `payout_${payout.id}`,
        metadata: {
          payout_id: payout.id,
          reseller_id: r.id,
          period_month: payout.periodMonth.toString(),
        },
      },
      { idempotencyKey: `payout_${payout.id}_attempt_${attemptN}` },
    );

    await db
      .update(resellerPayouts)
      .set({ stripeTransferId: transfer.id, status: "sent" })
      .where(eq(resellerPayouts.id, payout.id));

    return transfer.id;
  } catch (err) {
    await db
      .update(resellerPayouts)
      .set({
        status: "failed",
        failureCode: "transfer_create_error",
        failureMessage: err instanceof Error ? err.message : String(err),
      })
      .where(eq(resellerPayouts.id, payout.id));
    throw err;
  }
}
