// web/lib/payouts/strategies/es.ts
// Estrategia España — autonomo_es / autonomo_new_es / sl_es (+ Canarias IGIC).
//
// Base pre-IVA es la misma. Sobre la base:
// - IVA 21% repercutido (estándar) / 7% IGIC si Canarias.
// - IRPF retenido (Mario guarda para Modelo 111/190):
//   * autonomo_es:     15%
//   * autonomo_new_es:  7% (primeros 2 años, RIRPF art. 95)
//   * sl_es:            0% (por defecto — asesor confirma caso a caso)
// - Transfer a la connected account Stripe = base + IVA - IRPF.
// - Verifactu self-billing invoice se genera después (F5.6 post-MVP o stub).
// - Reporting: modelo_111 (trimestral) + 190 (anual) + 347 (>3005.06 €/año).

import type { Reseller } from "@/lib/db/schema";
import { applyDebtClawback, type TaxBreakdown, type TaxStrategy } from "./types";

const CANARIAS_PROVINCES = new Set(["35", "38"]);
const IVA_STANDARD = 0.21;
const IGIC_STANDARD = 0.07;
const IRPF_AUTONOMO = 0.15;
const IRPF_AUTONOMO_NEW = 0.07;

function isCanarias(r: Reseller): boolean {
  if (!r.billingAddress || typeof r.billingAddress !== "object") return false;
  const addr = r.billingAddress as Record<string, unknown>;
  const province =
    typeof addr.province_code === "string"
      ? addr.province_code
      : typeof addr.postal_code === "string"
        ? addr.postal_code.slice(0, 2)
        : null;
  return province !== null && CANARIAS_PROVINCES.has(province);
}

export const esStrategy: TaxStrategy = {
  code: "es",
  canApply(r) {
    return r.countryCode === "ES" && r.iaeRegistered && r.fiscalSubProfile !== null;
  },
  calculate(r, sourceCents, debtCents): TaxBreakdown {
    const { base_cents, debt_clawback_cents } = applyDebtClawback(sourceCents, debtCents);
    const canarias = isCanarias(r);
    const vat_rate = canarias ? IGIC_STANDARD : IVA_STANDARD;
    const vat_cents = Math.round(base_cents * vat_rate);

    let withholding_rate = 0;
    const warnings: string[] = [];
    switch (r.fiscalSubProfile) {
      case "autonomo_es":
        withholding_rate = IRPF_AUTONOMO;
        break;
      case "autonomo_new_es":
        withholding_rate = IRPF_AUTONOMO_NEW;
        warnings.push("autonomo_new_es_irpf_7pct — válido solo 2 primeros años tras alta IAE");
        break;
      case "sl_es":
        withholding_rate = 0;
        warnings.push("sl_es_irpf_unverified — confirmar con asesor (actividad mercantil vs profesional)");
        break;
      default:
        warnings.push("fiscal_sub_profile_missing — revisión manual requerida");
    }
    const withholding_cents = Math.round(base_cents * withholding_rate);

    const reporting_forms = ["modelo_111", "modelo_190"];
    if (canarias) reporting_forms.push("igic_declaracion");
    // Modelo 347 lo evalúa el agregador anual, aquí solo flag.
    reporting_forms.push("modelo_347_candidate");

    return {
      source_cents: sourceCents,
      base_cents,
      debt_clawback_cents,
      vat_rate,
      vat_cents,
      withholding_rate,
      withholding_cents,
      transfer_cents: base_cents + vat_cents - withholding_cents,
      requires_self_billing: true,
      requires_vat_id_validation: false,
      reporting_forms,
      warnings,
    };
  },
};
