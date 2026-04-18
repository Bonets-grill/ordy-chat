// web/lib/payouts/strategies/eu-vat.ts
// Estrategia UE (fuera ES) con VAT-ID válido — reverse charge intracomunitario.
//
// Directiva 2006/112/CE art. 44 + LIVA art. 69. Mario NO repercute IVA,
// el reseller autoliquida en su país. Modelo 349 anual (Mario) obligatorio.
// No se emite self-billing desde Ordy — el reseller emite su propia factura
// y la sube al panel (TODO F5 post-MVP: upload PDF).

import type { TaxBreakdown, TaxStrategy } from "./types";
import { applyDebtClawback } from "./types";

export const euVatStrategy: TaxStrategy = {
  code: "eu-vat",
  canApply(r) {
    // taxStrategy ya fue resuelto en countryConfig — defensa extra.
    return r.countryCode !== "ES" && r.taxIdType === "vat_eu" && r.taxId !== null;
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
      requires_vat_id_validation: true,
      reporting_forms: ["modelo_349"],
      warnings: [],
    };
  },
};
