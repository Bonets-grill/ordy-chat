// web/app/api/reseller/stripe-connect/callback/route.ts
// GET: callback tras completar (o abandonar) el onboarding Express de Stripe.
// Anti-hijack: valida que session.user.id === reseller.userId del acctId.
// Actualiza stripeConnectStatus + payouts_enabled + charges_enabled.

import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditLog, resellers } from "@/lib/db/schema";
import { stripeClient } from "@/lib/stripe";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await auth();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://ordychat.ordysuite.com";
  if (!session?.user?.id || session.user.role !== "reseller") {
    return NextResponse.redirect(`${appUrl}/signin?from=/reseller/settings`);
  }

  const acctId = req.nextUrl.searchParams.get("acct");
  if (!acctId) {
    return NextResponse.redirect(`${appUrl}/reseller/settings?connect=error`);
  }

  // Anti-hijack: el acctId debe pertenecer al reseller de la sesión.
  const [reseller] = await db
    .select()
    .from(resellers)
    .where(eq(resellers.stripeConnectAccountId, acctId))
    .limit(1);
  if (!reseller || reseller.userId !== session.user.id) {
    await db.insert(auditLog).values({
      action: "reseller.stripe_connect.callback_hijack_attempt",
      entity: "reseller",
      userId: session.user.id,
      metadata: { attempted_account: acctId, reseller_owner: reseller?.userId ?? null },
    });
    return NextResponse.redirect(`${appUrl}/reseller/settings?connect=hijack_blocked`);
  }

  // Refrescar status desde Stripe
  const stripe = await stripeClient();
  const account = await stripe.accounts.retrieve(acctId);
  const payoutsEnabled = Boolean(account.payouts_enabled);
  const chargesEnabled = Boolean(account.charges_enabled);
  const disabled = account.requirements?.disabled_reason ?? null;
  const status =
    payoutsEnabled && chargesEnabled
      ? "active"
      : disabled
        ? "restricted"
        : "pending";

  await db
    .update(resellers)
    .set({
      stripeConnectStatus: status,
      stripeConnectPayoutsEnabled: payoutsEnabled,
      stripeConnectChargesEnabled: chargesEnabled,
    })
    .where(eq(resellers.id, reseller.id));

  await db.insert(auditLog).values({
    action: "reseller.stripe_connect.callback_completed",
    entity: "reseller",
    entityId: reseller.id,
    userId: session.user.id,
    metadata: {
      status,
      payouts_enabled: payoutsEnabled,
      charges_enabled: chargesEnabled,
      disabled_reason: disabled,
    },
  });

  return NextResponse.redirect(`${appUrl}/reseller/settings?connect=${status}`);
}
