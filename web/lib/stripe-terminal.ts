// web/lib/stripe-terminal.ts — Helpers para Stripe Terminal multi-tenant.
//
// Cada tenant es una cuenta Stripe Connect Standard. Todas las llamadas a la
// API pasan el header `Stripe-Account` con `tenants.stripe_account_id`. Si el
// tenant no tiene Connect montado, las funciones lanzan TenantNotConnected.
//
// Mig 045.

import type Stripe from "stripe";
import { stripeClient } from "./stripe";

export class TenantNotConnected extends Error {
  constructor(tenantId: string) {
    super(`tenant ${tenantId} no tiene stripe_account_id configurado`);
    this.name = "TenantNotConnected";
  }
}

/**
 * Devuelve `{ stripe, requestOptions }` listo para invocar API de Stripe en
 * nombre del tenant. `requestOptions` incluye el `stripeAccount` que el SDK
 * traduce a header `Stripe-Account`.
 *
 * Si el tenant no tiene `stripeAccountId`, lanza TenantNotConnected.
 */
export async function stripeForTenant(tenant: {
  id: string;
  stripeAccountId: string | null;
}): Promise<{ stripe: Stripe; requestOptions: Stripe.RequestOptions }> {
  if (!tenant.stripeAccountId) {
    throw new TenantNotConnected(tenant.id);
  }
  const stripe = await stripeClient();
  return {
    stripe,
    requestOptions: { stripeAccount: tenant.stripeAccountId },
  };
}

/** Coste estimado por transacción en EU para Stripe Terminal (informativo). */
export const STRIPE_TERMINAL_FEE_INFO = {
  rate: "1.4% + 0.25€",
  region: "EU",
} as const;
