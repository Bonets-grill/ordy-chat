// web/lib/payouts/strategies/fallback.ts
// Resto del mundo (fuera ES, fuera UE con VAT-ID).
//
// Mario paga comisión base directa; el reseller asume TODA su obligación
// fiscal local (cláusula contractual obligatoria en Reseller Agreement):
// "Reseller is solely responsible for tax compliance in their jurisdiction."
//
// Futuras strategies específicas (US 1099-NEC, UK IR35) se añaden como
// plugins nuevos cuando exista reseller real en ese país.

import type { TaxBreakdown, TaxStrategy } from "./types";
import { applyDebtClawback } from "./types";

export const fallbackStrategy: TaxStrategy = {
  code: "fallback",
  canApply() {
    return true;
  },
  calculate(_r, sourceCents, debtCents): TaxBreakdown {
    const { base_cents, debt_clawback_cents } = applyDebtClawback(sourceCents, debtCents);
    return {
      source_cents: sourceCents,
      base_cents,
      debt_clawback_cents,
      vat_rate: 0,
      vat_cents: 0,
      withholding_rate: 0,
      withholding_cents: 0,
      transfer_cents: base_cents,
      requires_self_billing: false,
      requires_vat_id_validation: false,
      reporting_forms: [],
      warnings: ["reseller_assumes_local_tax_compliance"],
    };
  },
};
