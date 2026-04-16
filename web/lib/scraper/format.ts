// lib/scraper/format.ts — Convierte datos extraídos a texto plano para el system_prompt.

import type { ExtractedData } from "./extract";

export function formatForAgent(data: ExtractedData): string {
  const lines: string[] = [];
  const b = data.business ?? {};

  if (b.name) lines.push(`# ${b.name}`);
  if (b.description) lines.push(b.description);
  lines.push("");

  const info: string[] = [];
  if (b.phone) info.push(`Teléfono: ${b.phone}`);
  if (b.email) info.push(`Email: ${b.email}`);
  if (b.address) info.push(`Dirección: ${b.address}`);
  if (b.hours) info.push(`Horario: ${b.hours}`);
  if (b.website) info.push(`Web: ${b.website}`);
  if (b.social && Object.keys(b.social).length > 0) {
    info.push(`Redes: ${Object.entries(b.social).map(([k, v]) => `${k}:${v}`).join(", ")}`);
  }
  if (info.length > 0) {
    lines.push("## Datos de contacto");
    lines.push(...info);
    lines.push("");
  }

  if (data.categories && data.categories.length > 0) {
    lines.push("## Catálogo");
    for (const cat of data.categories) {
      lines.push(`### ${cat.name}`);
      if (cat.description) lines.push(cat.description);
      for (const item of cat.items ?? []) {
        const row = [`- **${item.name}**`];
        if (item.price) row.push(`(${item.price})`);
        lines.push(row.join(" "));
        if (item.description) lines.push(`  ${item.description}`);
        if (item.allergens && item.allergens.length > 0) {
          lines.push(`  Alérgenos: ${item.allergens.join(", ")}`);
        }
        if (item.modifiers && item.modifiers.length > 0) {
          for (const mod of item.modifiers) {
            lines.push(`  ${mod.name}: ${mod.options.join(", ")}`);
          }
        }
      }
      lines.push("");
    }
  }

  if (data.faqs && data.faqs.length > 0) {
    lines.push("## FAQ");
    for (const q of data.faqs) {
      lines.push(`Q: ${q.question}`);
      lines.push(`A: ${q.answer}`);
    }
    lines.push("");
  }

  if (data.notes) {
    lines.push("## Notas adicionales");
    lines.push(data.notes);
  }

  return lines.join("\n").trim();
}
