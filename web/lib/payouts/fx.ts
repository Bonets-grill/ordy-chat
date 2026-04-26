// web/lib/payouts/fx.ts
// FX rates para payout preview + lectura post-transfer de Stripe.
//
// PREVIEW (draft/ready payouts):
//   - ECB daily XML (https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml)
//   - Free, no auth, actualizado diariamente ~14:00 CET.
//   - Cacheado en memoria 24h.
//
// POST-TRANSFER (payout paid):
//   - Se lee de la balance_transaction del charge destino en la connected
//     account (stripe.balanceTransactions.retrieve con stripeAccount header).
//   - bt.exchange_rate da el FX aplicado por Stripe.

import type Stripe from "stripe";

const ECB_URL =
  process.env.ECB_RATES_URL ?? "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

type Cache = { ts: number; rates: Record<string, number> };
let _cache: Cache | null = null;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

async function loadEcbRates(): Promise<Record<string, number>> {
  const now = Date.now();
  if (_cache && now - _cache.ts < CACHE_TTL_MS) return _cache.rates;
  const res = await fetch(ECB_URL, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`ECB rates fetch failed: ${res.status} ${res.statusText}`);
  }
  const xml = await res.text();
  const rates: Record<string, number> = { EUR: 1 };
  const re = /currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9.]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const code = m[1];
    const rate = parseFloat(m[2]);
    if (Number.isFinite(rate) && rate > 0) rates[code] = rate;
  }
  _cache = { ts: now, rates };
  return rates;
}

/**
 * Preview rate EUR → targetCurrency (1 EUR = N target).
 * Si target = EUR devuelve 1. Si falla la fetch se lanza error para que el
 * cron logue y deje payout.fx_rate = NULL (no bloquea la ejecución).
 */
export async function ecbPreviewRate(targetCurrency: string): Promise<number> {
  const cc = targetCurrency.toUpperCase();
  if (cc === "EUR") return 1;
  const rates = await loadEcbRates();
  const rate = rates[cc];
  if (!rate) throw new Error(`fx_rate_unavailable:${cc}`);
  return rate;
}

/**
 * Post-transfer: lee exchange_rate real de la connected account.
 * Requiere el stripe client ya autenticado y el connected account id.
 * Si la cuenta destino es EUR (no hay conversión) devuelve rate=1.
 */
export async function readPostTransferFx(args: {
  stripe: Stripe;
  transferId: string;
  connectedAccountId: string;
}): Promise<{ rate: number; payoutTotalCents: number } | null> {
  const { stripe, transferId, connectedAccountId } = args;
  const transfer = await stripe.transfers.retrieve(transferId);
  const btRaw = transfer.destination_payment;
  const destinationPaymentId = typeof btRaw === "string" ? btRaw : btRaw?.id;
  if (!destinationPaymentId) return null;

  // El destination_payment es un Charge en la connected account; su
  // balance_transaction da el exchange_rate aplicado.
  // Stripe SDK v22 eliminó el overload retrieve(id, options). Hay que pasar
  // params (undefined) y options (con stripeAccount) como argumentos separados.
  const charge = await stripe.charges.retrieve(
    destinationPaymentId,
    undefined,
    { stripeAccount: connectedAccountId },
  );
  const btId =
    typeof charge.balance_transaction === "string"
      ? charge.balance_transaction
      : charge.balance_transaction?.id;
  if (!btId) return null;
  const bt = await stripe.balanceTransactions.retrieve(btId, undefined, {
    stripeAccount: connectedAccountId,
  });
  return {
    rate: bt.exchange_rate ?? 1,
    payoutTotalCents: bt.amount,
  };
}

/** Preview del payout en moneda del reseller (solo para UI). */
export function applyFxPreview(
  sourceCents: number,
  rate: number,
): number {
  return Math.round(sourceCents * rate);
}
