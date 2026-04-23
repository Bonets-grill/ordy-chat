// web/app/m/[slug]/speech-normalize.ts
//
// Normalización de texto para TTS nativo del navegador (speechSynthesis).
// El TTS por defecto lee fatal:
//   - "6 ud"   → "seis u-de" (letras sueltas)
//   - "— 7,50 €" → "menos siete coma cincuenta euros"
//   - URLs letra a letra
// Este módulo masajea el texto antes de sintetizarlo para que suene humano.
//
// No intenta ser un conversor número→palabras (las voces ES ya dicen "siete
// con cincuenta euros" si le damos la forma correcta). Solo arregla los
// disparadores más comunes en menús de restaurante.

import type { Lang } from "./translations";

export function normalizeForSpeech(text: string, lang: Lang): string {
  let out = text;

  // ── Fase 1: limpieza común a todos los idiomas ─────────────
  // Markdown links [label](url) → solo label.
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");
  // URLs desnudas: http(s)://… y www.…
  out = out.replace(/https?:\/\/\S+/gi, "");
  out = out.replace(/\bwww\.\S+/gi, "");
  // Emojis + selectores de variación + ZWJ.
  out = out.replace(/\p{Extended_Pictographic}/gu, "");
  out = out.replace(/[\u{FE0F}\u{200D}]/gu, "");
  // Markdown básico.
  out = out.replace(/[*_`#>]/g, "");
  // Em/en dash → coma (muchos TTS leen el guión largo como "menos",
  // sobre todo cuando va pegado a un número: "— 7,50 €").
  out = out.replace(/\s*[—–]\s*/g, ", ");

  // ── Fase 2: normalizaciones por idioma ─────────────────────
  out = normalizePrices(out, lang);
  out = normalizeUnits(out, lang);

  // ── Fase 3: colapso de espacios y puntuación ──────────────
  out = out
    .replace(/[ \t]+/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\s+([.,;!?])/g, "$1") // limpia espacios sueltos
    .replace(/,\s*,/g, ",") // comas duplicadas tras dropear URL/dash
    .trim();

  return out;
}

// Precios "X,YZ €" / "X,YZ EUR" → forma que el TTS lee bien.
// ES:  "7,50 €"  → "7 con 50 euros"
//      "7,00 €"  → "7 euros"
//      "7 €"     → "7 euros"
// EN:  "7.50 €"  → "7 euros 50"
// FR:  "7,50 €"  → "7 euros 50"
// Las demás: mantenemos "X,YZ €" pero expandimos el símbolo.
function normalizePrices(text: string, lang: Lang): string {
  let out = text;

  if (lang === "es") {
    out = out.replace(/(\d+),0{1,2}\s*(?:€|EUR)(?!\w)/gi, "$1 euros");
    out = out.replace(/(\d+),(\d{1,2})\s*(?:€|EUR)(?!\w)/gi, "$1 con $2 euros");
    out = out.replace(/(\d+)\s*€/g, "$1 euros");
  } else if (lang === "fr" || lang === "it" || lang === "pt") {
    const wordEuros = lang === "fr" ? "euros" : lang === "it" ? "euro" : "euros";
    out = out.replace(new RegExp(`(\\d+),0{1,2}\\s*(?:€|EUR)(?!\\w)`, "gi"), `$1 ${wordEuros}`);
    out = out.replace(new RegExp(`(\\d+),(\\d{1,2})\\s*(?:€|EUR)(?!\\w)`, "gi"), `$1 ${wordEuros} $2`);
    out = out.replace(/(\d+)\s*€/g, `$1 ${wordEuros}`);
  } else if (lang === "en") {
    // Punto decimal.
    out = out.replace(/(\d+)\.0{1,2}\s*(?:€|EUR)(?!\w)/gi, "$1 euros");
    out = out.replace(/(\d+)\.(\d{1,2})\s*(?:€|EUR)(?!\w)/gi, "$1 euros $2");
    // Si igualmente vino con coma (menú en ES pero voz EN), degradamos grácil.
    out = out.replace(/(\d+),(\d{1,2})\s*(?:€|EUR)(?!\w)/gi, "$1 euros $2");
    out = out.replace(/(\d+)\s*€/g, "$1 euros");
  } else if (lang === "de") {
    // Alemán usa coma decimal como ES.
    out = out.replace(/(\d+),0{1,2}\s*(?:€|EUR)(?!\w)/gi, "$1 Euro");
    out = out.replace(/(\d+),(\d{1,2})\s*(?:€|EUR)(?!\w)/gi, "$1 Euro $2");
    out = out.replace(/(\d+)\s*€/g, "$1 Euro");
  }

  return out;
}

// Abreviaciones de unidades → palabra completa.
// ES:  "6 ud" / "6 uds" / "6 ud." → "6 unidades"
//      "1 ud" → "1 unidad"
// EN:  "6 pcs" → "6 pieces"
// Resto: no-op por ahora.
function normalizeUnits(text: string, lang: Lang): string {
  let out = text;

  if (lang === "es") {
    // Singular primero para que "1 ud" no caiga en la regla plural.
    out = out.replace(/\b1\s*uds?\.?\b/gi, "1 unidad");
    out = out.replace(/(\d+)\s*uds?\.?\b/gi, "$1 unidades");
    out = out.replace(/\buds?\.?\b/gi, "unidades");
    // Otras: min, hrs → escritas.
    out = out.replace(/(\d+)\s*min\b/gi, "$1 minutos");
    out = out.replace(/(\d+)\s*h\b/gi, "$1 horas");
  } else if (lang === "en") {
    out = out.replace(/\b1\s*pcs?\b/gi, "1 piece");
    out = out.replace(/(\d+)\s*pcs?\b/gi, "$1 pieces");
    out = out.replace(/(\d+)\s*mins?\b/gi, "$1 minutes");
    out = out.replace(/(\d+)\s*hrs?\b/gi, "$1 hours");
  }

  return out;
}
