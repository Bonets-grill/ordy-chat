// web/lib/reseller/countries.ts
// Mapping country_code (ISO 3166-1 alpha-2) → currency (ISO 4217) + tax strategy.
// Solo países soportados por Stripe Connect (46 oficiales, incluimos los principales).
// Países no listados aquí → onboarding bloqueado.

export type TaxStrategyCode = "es" | "eu-vat" | "fallback";

interface CountryConfig {
  currency: string;
  strategy: TaxStrategyCode;
  /** ¿UE (para reverse charge eu-vat)? */
  eu: boolean;
  /** ¿SEPA zone (EUR)? */
  sepa: boolean;
}

// SEPA zone (incluye EUR + algunos EEA)
const SEPA_EUR = new Set([
  "ES", "FR", "DE", "IT", "NL", "PT", "BE", "IE", "AT", "FI", "LU",
  "GR", "CY", "SK", "SI", "EE", "LV", "LT", "MT",
]);

// UE con VAT-ID (reverse charge aplica). Excluye ES (estrategia propia).
const EU_COUNTRIES = new Set([
  "FR", "DE", "IT", "NL", "PT", "BE", "IE", "AT", "FI", "LU", "GR", "CY",
  "SK", "SI", "EE", "LV", "LT", "MT",
  // Fuera-SEPA-EUR pero UE
  "PL", "CZ", "HU", "RO", "BG", "HR", "DK", "SE",
]);

// Currency mapping (ISO 4217)
const CURRENCY_BY_COUNTRY: Record<string, string> = {
  // SEPA EUR
  ES: "EUR", FR: "EUR", DE: "EUR", IT: "EUR", NL: "EUR", PT: "EUR", BE: "EUR",
  IE: "EUR", AT: "EUR", FI: "EUR", LU: "EUR", GR: "EUR", CY: "EUR", SK: "EUR",
  SI: "EUR", EE: "EUR", LV: "EUR", LT: "EUR", MT: "EUR",
  // UE no-EUR
  PL: "PLN", CZ: "CZK", HU: "HUF", RO: "RON", BG: "BGN", HR: "EUR", DK: "DKK", SE: "SEK",
  // EEA + no-UE Europa
  GB: "GBP", CH: "CHF", NO: "NOK", IS: "ISK", LI: "CHF",
  // Américas
  US: "USD", CA: "CAD", MX: "MXN", BR: "BRL",
  // APAC
  AU: "AUD", NZ: "NZD", JP: "JPY", SG: "SGD", HK: "HKD", MY: "MYR", TH: "THB", IN: "INR",
  // Otros
  AE: "AED",
};

export function countryConfig(code: string): CountryConfig | null {
  const cc = code.toUpperCase();
  const currency = CURRENCY_BY_COUNTRY[cc];
  if (!currency) return null;

  let strategy: TaxStrategyCode;
  if (cc === "ES") strategy = "es";
  else if (EU_COUNTRIES.has(cc)) strategy = "eu-vat";
  else strategy = "fallback";

  return {
    currency,
    strategy,
    eu: cc === "ES" || EU_COUNTRIES.has(cc),
    sepa: SEPA_EUR.has(cc),
  };
}

export function isCountrySupported(code: string): boolean {
  return countryConfig(code) !== null;
}

export const SUPPORTED_COUNTRIES = Object.keys(CURRENCY_BY_COUNTRY);
