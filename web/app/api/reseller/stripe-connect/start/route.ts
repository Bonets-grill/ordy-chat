// web/app/api/reseller/stripe-connect/start/route.ts
// POST: inicia (o reanuda) onboarding Stripe Connect Express para el reseller
// autenticado. Devuelve { url } para redirect.
//
// Capabilities: transfers only (NO card_payments — Mario cobra al cliente,
// no el reseller). Country = reseller.countryCode (debe estar en la lista
// soportada por Stripe Connect, validado en createReseller).

import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditLog, resellers } from "@/lib/db/schema";
import { limitByUserId } from "@/lib/rate-limit";
import { getSessionReseller } from "@/lib/reseller/scope";
import { stripeClient } from "@/lib/stripe";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "reseller") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const rate = await limitByUserId(session.user.id, "connect_start", 5, "1 h");
  if (!rate.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const reseller = await getSessionReseller(session);
  const stripe = await stripeClient();

  // 1. Crear o reutilizar Connect account
  let acctId = reseller.stripeConnectAccountId;
  if (!acctId) {
    const account = await stripe.accounts.create({
      type: "express",
      country: reseller.countryCode,
      capabilities: { transfers: { requested: true } },
      metadata: { reseller_id: reseller.id, slug: reseller.slug },
    });
    acctId = account.id;
    await db
      .update(resellers)
      .set({ stripeConnectAccountId: acctId })
      .where(eq(resellers.id, reseller.id));
    await db.insert(auditLog).values({
      action: "reseller.stripe_connect.account_created",
      entity: "reseller",
      entityId: reseller.id,
      userId: session.user.id,
      metadata: { stripe_account_id: acctId, country: reseller.countryCode },
    });
  }

  // 2. Generate Account Link (onboarding URL)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://ordychat.ordysuite.com";
  const link = await stripe.accountLinks.create({
    account: acctId,
    refresh_url: `${appUrl}/reseller/settings?connect=refresh`,
    return_url: `${appUrl}/api/reseller/stripe-connect/callback?acct=${acctId}`,
    type: "account_onboarding",
  });

  return NextResponse.json({ url: link.url });
}
