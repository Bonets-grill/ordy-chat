// web/lib/onboarding-fast/sanitize.ts — Defensa anti prompt-injection.
//
// Cualquier texto scrapeado de web/Google/TripAdvisor pasa por aquí ANTES de
// tocar el merger LLM. Hace dos cosas:
//   1. Strip de patrones de inyección conocidos.
//   2. Trunc a maxChars.
// Devuelve también QUÉ patrones se detectaron, para que el caller los pueda
// loggear a audit_log (tabla existente) con action='prompt_injection_blocked'.
//
// Diseño: función pura + sin I/O. El log async lo hace el caller (worker de
// scrape) cuando tenga user_id en contexto — simplifica tests y mantiene esta
// capa determinista.

const INJECTION_PATTERNS = [
  { name: "ignore_previous", source: "ignore\\s+(all|previous|the\\s+above)", flags: "gi" },
  { name: "system_tag", source: "system\\s*:", flags: "gi" },
  { name: "you_are_now", source: "you\\s+are\\s+now", flags: "gi" },
  { name: "assistant_tag", source: "assistant\\s*:", flags: "gi" },
  { name: "special_tokens", source: "<\\|[^|]*\\|>", flags: "g" },
  { name: "inst_tag", source: "\\[\\s*/?INST\\s*\\]", flags: "gi" },
  { name: "code_fence", source: "```[\\s\\S]*?```", flags: "g" },
  // Prompt-injection clásico español.
  { name: "ignora_instrucciones", source: "ignora\\s+(las\\s+)?(instrucciones|lo\\s+anterior)", flags: "gi" },
] as const;

export const DEFAULT_MAX_CHARS = 4000;

export type SanitizeResult = {
  /** Texto limpio, trimmed, listo para pasar al LLM. */
  clean: string;
  /** Nombres de los patrones detectados y strippeados. */
  detected: string[];
  /** true si el input original superaba maxChars. */
  truncated: boolean;
};

/**
 * Limpia un texto scrapeado de patrones de prompt injection + trunca a maxChars.
 * Función pura. El caller decide si logea `detected` a `audit_log`.
 */
export function sanitizeScrapedText(
  input: string | null | undefined,
  maxChars: number = DEFAULT_MAX_CHARS,
): SanitizeResult {
  if (input == null || input === "") {
    return { clean: "", detected: [], truncated: false };
  }

  let out = input;
  const detected: string[] = [];

  for (const { name, source, flags } of INJECTION_PATTERNS) {
    // Cada regex fresca — el flag 'g' es stateful.
    const detector = new RegExp(source, flags);
    if (detector.test(out)) {
      detected.push(name);
      out = out.replace(new RegExp(source, flags), "");
    }
  }

  const truncated = out.length > maxChars;
  if (truncated) {
    out = out.slice(0, maxChars);
  }

  return { clean: out.trim(), detected, truncated };
}

/**
 * Sanitize recursivo sobre un objeto Partial<CanonicalBusiness> (o similar):
 * aplica sanitizeScrapedText a todo string hoja. Arrays y records se recorren.
 * Agrega todos los `detected` en un set único devuelto.
 */
export function sanitizeScrapedObject<T extends object>(
  obj: T,
  maxChars: number = DEFAULT_MAX_CHARS,
): { clean: T; detected: string[]; truncatedFields: string[] } {
  const detectedSet = new Set<string>();
  const truncatedFields: string[] = [];

  function walk(value: unknown, path: string): unknown {
    if (value == null) return value;
    if (typeof value === "string") {
      const r = sanitizeScrapedText(value, maxChars);
      r.detected.forEach((p) => detectedSet.add(p));
      if (r.truncated) truncatedFields.push(path);
      return r.clean;
    }
    if (Array.isArray(value)) {
      return value.map((v, i) => walk(v, `${path}[${i}]`));
    }
    if (typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        out[k] = walk(v, path ? `${path}.${k}` : k);
      }
      return out;
    }
    return value;
  }

  const clean = walk(obj, "") as T;
  return { clean, detected: Array.from(detectedSet), truncatedFields };
}
