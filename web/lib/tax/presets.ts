// web/lib/tax/presets.ts — Presets fiscales por región.
//
// Tenant elige una región del dropdown; el preset autopoblá los campos
// tax_system, standard, alcohol, prices_include_tax. El tenant siempre puede
// override manualmente los valores después.
//
// Regiones ES con particularidades fiscales reales:
//   - es_peninsula/Baleares: IVA (Verifactu AEAT)
//   - es_canarias: IGIC (SII-IGIC ATC; distinto endpoint)
//   - es_ceuta_melilla: IPSI (sin SII nacional)
//
// Otros países cubren los más comunes para el target actual; para regiones
// fuera de esta lista, el tenant usa 'other' + edición manual, o invoca el
// agente de research fiscal (Stream C).

export type TaxSystem =
  | "IVA"         // España península + Baleares
  | "IGIC"        // Canarias
  | "IPSI"        // Ceuta/Melilla
  | "VAT"         // UE + UK + genérico
  | "SALES_TAX"   // USA (estatal, varía)
  | "GST"         // Australia, India, etc.
  | "NONE"
  | "CUSTOM";

export type TaxRegion =
  | "es_peninsula"
  | "es_canarias"
  | "es_ceuta_melilla"
  | "pt" | "fr" | "it" | "de" | "uk"
  | "us" | "mx" | "co" | "ar" | "cl" | "pe"
  | "other";

export type TaxPreset = {
  system: TaxSystem;
  label: string;              // mostrar en recibos/UI
  standard: number;           // tasa default hostelería
  alcohol: number;            // tasa bebidas alcohólicas
  pricesIncludeTax: boolean;  // true = PVP incluye ya el impuesto
  sii: "verifactu" | "sii_igic" | null;
  notes?: string;
};

export const TAX_PRESETS: Record<TaxRegion, TaxPreset> = {
  es_peninsula:     { system: "IVA",  label: "IVA",  standard: 10.00, alcohol: 21.00, pricesIncludeTax: true, sii: "verifactu" },
  es_canarias:      { system: "IGIC", label: "IGIC", standard:  7.00, alcohol: 20.00, pricesIncludeTax: true, sii: "sii_igic"  },
  es_ceuta_melilla: { system: "IPSI", label: "IPSI", standard:  4.00, alcohol:  8.00, pricesIncludeTax: true, sii: null },

  pt: { system: "VAT", label: "IVA PT", standard: 13.00, alcohol: 23.00, pricesIncludeTax: true,  sii: null },
  fr: { system: "VAT", label: "TVA",    standard: 10.00, alcohol: 20.00, pricesIncludeTax: true,  sii: null },
  it: { system: "VAT", label: "IVA IT", standard: 10.00, alcohol: 22.00, pricesIncludeTax: true,  sii: null },
  de: { system: "VAT", label: "MwSt",   standard:  7.00, alcohol: 19.00, pricesIncludeTax: true,  sii: null },
  uk: { system: "VAT", label: "VAT",    standard: 20.00, alcohol: 20.00, pricesIncludeTax: true,  sii: null },

  us: { system: "SALES_TAX", label: "Sales Tax", standard: 0, alcohol: 0, pricesIncludeTax: false, sii: null, notes: "USA varía por estado/condado — configurar manualmente" },
  mx: { system: "VAT", label: "IVA",    standard: 16.00, alcohol: 16.00, pricesIncludeTax: true,  sii: null },
  co: { system: "VAT", label: "IVA",    standard:  8.00, alcohol: 19.00, pricesIncludeTax: true,  sii: null },
  ar: { system: "VAT", label: "IVA",    standard: 10.50, alcohol: 21.00, pricesIncludeTax: true,  sii: null },
  cl: { system: "VAT", label: "IVA",    standard: 19.00, alcohol: 19.00, pricesIncludeTax: true,  sii: null },
  pe: { system: "VAT", label: "IGV",    standard: 18.00, alcohol: 18.00, pricesIncludeTax: true,  sii: null },

  other: { system: "CUSTOM", label: "Impuesto", standard: 0, alcohol: 0, pricesIncludeTax: true, sii: null, notes: "Configurar manualmente o usar agente de research" },
};

/** Mapea un CP español a región fiscal. Para no-ES devuelve 'es_peninsula' por default. */
export function postalCodeToRegion(cp: string | null | undefined): TaxRegion {
  if (!cp) return "es_peninsula";
  const prefix = cp.trim().slice(0, 2);
  if (prefix === "35" || prefix === "38") return "es_canarias";        // Las Palmas / Tenerife
  if (prefix === "51" || prefix === "52") return "es_ceuta_melilla";
  if (/^\d{5}$/.test(cp.trim())) return "es_peninsula";                 // CP ES válido no-insular
  return "es_peninsula";                                                 // fallback
}

export const VALID_REGIONS: readonly TaxRegion[] = Object.keys(TAX_PRESETS) as TaxRegion[];
export const VALID_SYSTEMS: readonly TaxSystem[] = ["IVA","IGIC","IPSI","VAT","SALES_TAX","GST","NONE","CUSTOM"];
