// tests/unit/reseller/tax-strategies.test.ts
// Tests deterministas para las 3 tax strategies (es / eu-vat / fallback).
// Covers 4 perfiles fiscales + Canarias IGIC + carry-over debt.

import { describe, expect, it } from "vitest";
import { esStrategy } from "@/lib/payouts/strategies/es";
import { euVatStrategy } from "@/lib/payouts/strategies/eu-vat";
import { fallbackStrategy } from "@/lib/payouts/strategies/fallback";
import type { Reseller } from "@/lib/db/schema";

function mockReseller(overrides: Partial<Reseller> = {}): Reseller {
  return {
    id: "r1",
    userId: "u1",
    slug: "test",
    brandName: "Test",
    commissionRate: "0.2500",
    status: "active",
    stripeConnectAccountId: null,
    stripeConnectStatus: "pending",
    stripeConnectPayoutsEnabled: false,
    stripeConnectChargesEnabled: false,
    countryCode: "ES",
    taxStrategy: "es",
    payoutCurrency: "EUR",
    legalName: null,
    taxId: null,
    taxIdType: null,
    fiscalSubProfile: null,
    iaeRegistered: true,
    billingAddress: null,
    commissionDebtCents: 0,
    selfBillingConsentedAt: null,
    selfBillingAgreementVersion: null,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const SOURCE = 41100; // 411.00 EUR commission (100 tenants × 4.11 EUR)

describe("esStrategy — autonomo_es", () => {
  const r = mockReseller({ fiscalSubProfile: "autonomo_es", countryCode: "ES", iaeRegistered: true });

  it("calcula IVA 21% + IRPF 15%", () => {
    const b = esStrategy.calculate(r, SOURCE, 0);
    expect(b.source_cents).toBe(41100);
    expect(b.base_cents).toBe(41100);
    expect(b.vat_rate).toBe(0.21);
    expect(b.vat_cents).toBe(Math.round(41100 * 0.21)); // 8631
    expect(b.withholding_rate).toBe(0.15);
    expect(b.withholding_cents).toBe(Math.round(41100 * 0.15)); // 6165
    expect(b.transfer_cents).toBe(41100 + 8631 - 6165); // 43566
    expect(b.requires_self_billing).toBe(true);
    expect(b.reporting_forms).toContain("modelo_111");
    expect(b.reporting_forms).toContain("modelo_190");
    expect(b.warnings).toEqual([]);
  });

  it("canApply exige IAE + fiscal_sub_profile", () => {
    expect(esStrategy.canApply(r)).toBe(true);
    expect(esStrategy.canApply({ ...r, iaeRegistered: false })).toBe(false);
    expect(esStrategy.canApply({ ...r, fiscalSubProfile: null })).toBe(false);
    expect(esStrategy.canApply({ ...r, countryCode: "FR" })).toBe(false);
  });
});

describe("esStrategy — autonomo_new_es (IRPF 7%)", () => {
  const r = mockReseller({ fiscalSubProfile: "autonomo_new_es" });
  it("IVA 21% + IRPF 7% + warning sobre ventana 2 años", () => {
    const b = esStrategy.calculate(r, SOURCE, 0);
    expect(b.withholding_rate).toBe(0.07);
    expect(b.withholding_cents).toBe(Math.round(41100 * 0.07)); // 2877
    expect(b.transfer_cents).toBe(41100 + 8631 - 2877); // 46854
    expect(b.warnings.some((w) => w.startsWith("autonomo_new_es_irpf_7pct"))).toBe(true);
  });
});

describe("esStrategy — sl_es (IRPF 0% con warning)", () => {
  const r = mockReseller({ fiscalSubProfile: "sl_es" });
  it("IVA 21% + IRPF 0% + warning unverified", () => {
    const b = esStrategy.calculate(r, SOURCE, 0);
    expect(b.withholding_rate).toBe(0);
    expect(b.withholding_cents).toBe(0);
    expect(b.transfer_cents).toBe(41100 + 8631);
    expect(b.warnings.some((w) => w.startsWith("sl_es_irpf_unverified"))).toBe(true);
  });
});

describe("esStrategy — Canarias (IGIC 7% en vez de IVA)", () => {
  const r = mockReseller({
    fiscalSubProfile: "autonomo_es",
    billingAddress: { province_code: "35" },
  });
  it("sustituye IVA 21% por IGIC 7%", () => {
    const b = esStrategy.calculate(r, SOURCE, 0);
    expect(b.vat_rate).toBe(0.07);
    expect(b.vat_cents).toBe(Math.round(41100 * 0.07)); // 2877
    expect(b.withholding_rate).toBe(0.15);
    expect(b.reporting_forms).toContain("igic_declaracion");
  });

  it("detecta Canarias también por postal_code 35/38", () => {
    const r2 = mockReseller({
      fiscalSubProfile: "autonomo_es",
      billingAddress: { postal_code: "38001 Santa Cruz" },
    });
    const b = esStrategy.calculate(r2, SOURCE, 0);
    expect(b.vat_rate).toBe(0.07);
  });
});

describe("euVatStrategy — reverse charge intracomunitario", () => {
  const r = mockReseller({
    countryCode: "FR",
    taxStrategy: "eu-vat",
    payoutCurrency: "EUR",
    taxIdType: "vat_eu",
    taxId: "FR12345678901",
    iaeRegistered: false,
  });
  it("IVA=0, IRPF=0, solo reporta modelo_349", () => {
    const b = euVatStrategy.calculate(r, SOURCE, 0);
    expect(b.vat_rate).toBe(0);
    expect(b.withholding_rate).toBe(0);
    expect(b.transfer_cents).toBe(41100);
    expect(b.requires_vat_id_validation).toBe(true);
    expect(b.reporting_forms).toContain("modelo_349");
  });
  it("canApply exige VAT-ID tipo vat_eu", () => {
    expect(euVatStrategy.canApply(r)).toBe(true);
    expect(euVatStrategy.canApply({ ...r, taxIdType: "other" })).toBe(false);
    expect(euVatStrategy.canApply({ ...r, taxId: null })).toBe(false);
    expect(euVatStrategy.canApply({ ...r, countryCode: "ES" })).toBe(false);
  });
});

describe("fallbackStrategy — resto del mundo", () => {
  const r = mockReseller({
    countryCode: "US",
    taxStrategy: "fallback",
    payoutCurrency: "USD",
    iaeRegistered: false,
  });
  it("transfer = source, warning de responsabilidad local", () => {
    const b = fallbackStrategy.calculate(r, SOURCE, 0);
    expect(b.transfer_cents).toBe(41100);
    expect(b.warnings).toContain("reseller_assumes_local_tax_compliance");
    expect(b.reporting_forms).toEqual([]);
  });
});

describe("debt clawback — carry-over de refund cross-period", () => {
  const r = mockReseller({ fiscalSubProfile: "autonomo_es" });

  it("deuda menor que source → descuenta y queda base = source - debt", () => {
    const b = esStrategy.calculate(r, 10000, 2500);
    expect(b.debt_clawback_cents).toBe(2500);
    expect(b.base_cents).toBe(7500);
    expect(b.vat_cents).toBe(Math.round(7500 * 0.21)); // 1575
  });

  it("deuda >= source → base = 0 (payout no se creará por MIN_PAYOUT)", () => {
    const b = esStrategy.calculate(r, 1000, 5000);
    expect(b.debt_clawback_cents).toBe(1000);
    expect(b.base_cents).toBe(0);
    expect(b.vat_cents).toBe(0);
    expect(b.transfer_cents).toBe(0);
  });
});
