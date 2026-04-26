// web/lib/stripe.ts — Cliente Stripe + helpers para la suscripción €49.90/mes.

import Stripe from "stripe";
import { db } from "./db";
import { descifrar } from "./crypto";
import { platformSettings } from "./db/schema";
import { eq } from "drizzle-orm";

let cached: Stripe | null = null;

export async function stripeClient(): Promise<Stripe> {
  if (cached) return cached;

  let secret = process.env.STRIPE_SECRET_KEY ?? "";
  if (!secret) {
    const [row] = await db
      .select()
      .from(platformSettings)
      .where(eq(platformSettings.key, "stripe_secret_key"))
      .limit(1);
    if (row?.valueEncrypted) {
      try { secret = descifrar(row.valueEncrypted); } catch { /* empty */ }
    }
  }
  if (!secret) throw new Error("STRIPE_SECRET_KEY no configurada");

  cached = new Stripe(secret, { apiVersion: "2026-04-22.dahlia" });
  return cached;
}

export async function stripePriceId(): Promise<string> {
  if (process.env.STRIPE_PRICE_ID) return process.env.STRIPE_PRICE_ID;
  const [row] = await db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.key, "stripe_price_id"))
    .limit(1);
  if (row?.valueEncrypted) {
    try { return descifrar(row.valueEncrypted); } catch { /* empty */ }
  }
  throw new Error("STRIPE_PRICE_ID no configurado");
}

export async function stripeWebhookSecret(): Promise<string> {
  if (process.env.STRIPE_WEBHOOK_SECRET) return process.env.STRIPE_WEBHOOK_SECRET;
  const [row] = await db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.key, "stripe_webhook_secret"))
    .limit(1);
  if (row?.valueEncrypted) {
    try { return descifrar(row.valueEncrypted); } catch { /* empty */ }
  }
  throw new Error("STRIPE_WEBHOOK_SECRET no configurado");
}
