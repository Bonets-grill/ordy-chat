// web/lib/csv.ts — Helpers compartidos para exportar CSV.
//
// Reglas RFC 4180-ish suficientes para que Excel/Numbers/LibreOffice importen
// bien con coma como separador:
//   - Si el valor contiene coma, comilla doble o salto de línea (LF o CR),
//     lo envolvemos en comillas dobles.
//   - Dentro de ese valor, cada comilla doble se duplica ("" ).
//
// Lo dejamos aquí para compartir entre endpoints de exports (conversaciones,
// reports de ventas, etc.) y no duplicar lógica — regla multi-tenant sigue
// viviendo en cada route que llama este helper.

export function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

// Une header + filas ya escapadas con el separador correcto.
// Cada fila es un string[] de celdas ya pasadas por csvEscape si hacía falta.
export function csvJoin(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const headerLine = header.join(",");
  const body = rows.map((r) => r.join(",")).join("\n");
  return body.length > 0 ? `${headerLine}\n${body}` : headerLine;
}

// Formatea cents (integer) como "12.34" (euros con punto decimal, sin símbolo).
// Lo dejamos numérico sin símbolo porque el contable lo importa y reformatea;
// los símbolos de moneda rompen formulas =SUM() en Excel ES.
export function centsToAmount(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const euros = Math.floor(abs / 100);
  const rest = abs % 100;
  return `${sign}${euros}.${rest.toString().padStart(2, "0")}`;
}

// Helper para armar filename atachado al CSV con tenant slug + fecha ISO.
// Si el slug viene vacío o con caracteres raros, lo saneamos.
export function csvFilename(parts: {
  base: string;
  tenantSlug?: string;
  id?: string;
  date?: Date;
}): string {
  // Sanea a nivel segmento: sólo [a-z0-9-], minúsculas, sin guiones repetidos
  // y sin guión al inicio/fin.
  const safe = (s: string) =>
    s
      .replace(/[^a-z0-9-]/gi, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase();
  const date = (parts.date ?? new Date()).toISOString().slice(0, 10);
  const bits = [
    safe(parts.base),
    parts.tenantSlug ? safe(parts.tenantSlug) : null,
    date,
    parts.id ? safe(parts.id).slice(0, 8) : null,
  ]
    .filter((b): b is string => b !== null && b.length > 0)
    .join("-");
  return `${bits}.csv`;
}
