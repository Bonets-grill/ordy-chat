// web/lib/payouts/registry.ts
// Resolver de TaxStrategy por reseller.taxStrategy.

import type { Reseller } from "@/lib/db/schema";
import { esStrategy } from "./strategies/es";
import { euVatStrategy } from "./strategies/eu-vat";
import { fallbackStrategy } from "./strategies/fallback";
import type { TaxStrategy, TaxStrategyCode } from "./strategies/types";

const REGISTRY: Record<TaxStrategyCode, TaxStrategy> = {
  es: esStrategy,
  "eu-vat": euVatStrategy,
  fallback: fallbackStrategy,
};

export function resolveTaxStrategy(reseller: Reseller): TaxStrategy {
  const code = reseller.taxStrategy as TaxStrategyCode;
  const s = REGISTRY[code];
  if (!s) throw new Error(`unknown_tax_strategy:${reseller.taxStrategy}`);
  // canApply es diagnóstico — si no aplica, logueamos y usamos fallback.
  if (!s.canApply(reseller)) {
    console.warn(
      `[payouts] strategy '${code}' canApply=false for reseller ${reseller.id}; falling back`,
    );
    return fallbackStrategy;
  }
  return s;
}
