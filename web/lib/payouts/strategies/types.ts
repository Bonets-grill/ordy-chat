// web/lib/payouts/strategies/types.ts
// Interfaz pluggable para cálculo fiscal de payouts por país.

import type { Reseller } from "@/lib/db/schema";

export type TaxStrategyCode = "es" | "eu-vat" | "fallback";

export interface TaxBreakdown {
  /** Suma de commission_amount_cents elegibles (EUR). */
  source_cents: number;
  /** Base imponible = source - debt_clawback si aplica. */
  base_cents: number;
  /** Deuda descontada (charge refund cross-period). */
  debt_clawback_cents: number;
  /** IVA/IGIC rate (0..1). */
  vat_rate: number;
  vat_cents: number;
  /** IRPF rate (0..1). ES autónomo=0.15, autónomo_new=0.07, resto=0. */
  withholding_rate: number;
  withholding_cents: number;
  /** Net transferido a la connected account vía Stripe transfers.create. */
  transfer_cents: number;
  requires_self_billing: boolean;
  requires_vat_id_validation: boolean;
  reporting_forms: string[];
  warnings: string[];
}

export interface TaxStrategy {
  readonly code: TaxStrategyCode;
  canApply(reseller: Reseller): boolean;
  /**
   * Calcula breakdown fiscal. `sourceCents` es la suma de commissions elegibles
   * y `debtCents` la deuda carry-over del reseller a descontar (puede ser 0).
   */
  calculate(reseller: Reseller, sourceCents: number, debtCents: number): TaxBreakdown;
}

/** Helper compartido — deduce base_cents + debt clawback. */
export function applyDebtClawback(sourceCents: number, debtCents: number) {
  const clawback = Math.min(sourceCents, debtCents);
  return {
    base_cents: sourceCents - clawback,
    debt_clawback_cents: clawback,
    remaining_debt: debtCents - clawback,
  };
}
