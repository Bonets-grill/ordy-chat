// web/app/api/stripe/terminal/connection-token/route.ts
//
// POST /api/stripe/terminal/connection-token — emite un ConnectionToken de
// Stripe Terminal para que un cliente (web/app) que use el SDK frontend de
// Stripe Terminal pueda conectarse al lector vía bluetooth/internet.
//
// MVP server-side: por defecto NO usamos el SDK frontend — el reader recibe
// instrucciones server-to-server vía processPaymentIntent. Pero dejamos
// expuesto este endpoint para evolución futura (smart readers WisePOS E que
// requieran token frontend).
//
// Auth: requiere session de tenant (no kiosk — emitir tokens fuera del flujo
// admin sería gratuito para un atacante con kioskToken).
// Multi-tenant: pasa Stripe-Account header con stripe_account_id del tenant.
//
// Mig 045.

import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/tenant";
import { TenantNotConnected, stripeForTenant } from "@/lib/stripe-terminal";

export const runtime = "nodejs";

export async function POST() {
  const bundle = await requireTenant();
  if (!bundle) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const { stripe, requestOptions } = await stripeForTenant({
      id: bundle.tenant.id,
      stripeAccountId: bundle.tenant.stripeAccountId,
    });
    const token = await stripe.terminal.connectionTokens.create(
      {},
      requestOptions,
    );
    return NextResponse.json({ secret: token.secret });
  } catch (e) {
    if (e instanceof TenantNotConnected) {
      return NextResponse.json(
        { error: "stripe_connect_missing", message: e.message },
        { status: 412 },
      );
    }
    return NextResponse.json(
      { error: "stripe_error", message: (e as Error).message },
      { status: 500 },
    );
  }
}
