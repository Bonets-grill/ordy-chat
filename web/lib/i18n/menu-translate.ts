// web/lib/i18n/menu-translate.ts
//
// Auto-translation de menu_items + modifier_groups + modifiers a EN/FR/IT/DE/PT/CA/EU.
// Mig 048. Cachea la traducción en menu_items.i18n_translations[lang] para no
// re-llamar al LLM cada visita.
//
// Estrategia:
//   - Una sola llamada Anthropic por request, batch JSON con todos los
//     items que falten en ese lang.
//   - El LLM devuelve JSON con shape { items: [{id, name, description}], ...}
//   - Persistimos UPDATE menu_items SET i18n_translations =
//       jsonb_set(i18n_translations, '{en}', '{...}'::jsonb) para cada item.

import Anthropic from "@anthropic-ai/sdk";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  menuItems,
  menuItemModifierGroups,
  menuItemModifiers,
} from "@/lib/db/schema";
import { resolveAnthropicApiKey } from "@/lib/anthropic-key";

export const SUPPORTED_LANGS = ["en", "fr", "it", "de", "pt", "ca", "eu"] as const;
export type SupportedLang = (typeof SUPPORTED_LANGS)[number];

const LANG_LABEL: Record<SupportedLang, string> = {
  en: "English",
  fr: "français",
  it: "italiano",
  de: "Deutsch",
  pt: "português",
  ca: "català",
  eu: "euskera",
};

type SourceItem = {
  id: string;
  kind: "item" | "modifier_group" | "modifier";
  name: string;
  description: string | null;
};

type Translation = {
  id: string;
  name: string;
  description: string | null;
};

type I18nMap = Record<string, { name: string; description?: string | null }>;

function pickFromI18n(
  i18n: unknown,
  lang: string,
): { name?: string; description?: string | null } | null {
  if (!i18n || typeof i18n !== "object") return null;
  const map = i18n as Record<string, unknown>;
  const entry = map[lang];
  if (!entry || typeof entry !== "object") return null;
  return entry as { name?: string; description?: string | null };
}

async function translateBatch(
  apiKey: string,
  lang: SupportedLang,
  sources: SourceItem[],
): Promise<Translation[]> {
  if (sources.length === 0) return [];

  const client = new Anthropic({ apiKey });
  const list = sources.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description ?? "",
  }));

  const userPrompt =
    `Traduce al ${LANG_LABEL[lang]} los siguientes items de un restaurante. ` +
    `Devuelve SOLO un JSON array con shape ` +
    `[{"id":"...","name":"...","description":"..."}]. Sin comentarios, sin markdown. ` +
    `IMPORTANTE: si un nombre es un nombre propio o de marca (ej "Coca-Cola", ` +
    `"Dacoka Burger"), DÉJALO EN ESPAÑOL. Si dudas, mantén el original. La ` +
    `description sí se traduce siempre. Devuelve description="" si la fuente es vacía.\n\n` +
    JSON.stringify(list);

  const resp = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4096,
    messages: [{ role: "user", content: userPrompt }],
  });
  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  // Acepta JSON puro o envuelto en ```json … ```.
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: Translation[] = [];
  for (const r of parsed) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.name !== "string") continue;
    out.push({
      id: o.id,
      name: o.name,
      description: typeof o.description === "string" ? o.description : null,
    });
  }
  return out;
}

/**
 * Devuelve menu_items + modifier_groups + modifiers traducidos al lang. Si
 * faltan traducciones, las genera con el LLM y las persiste en DB.
 */
export async function getTranslatedMenu(
  tenantId: string,
  lang: SupportedLang,
): Promise<{
  items: Array<{
    id: string;
    name: string;
    description: string | null;
    priceCents: number;
    category: string;
    imageUrl: string | null;
  }>;
}> {
  const items = await db
    .select({
      id: menuItems.id,
      name: menuItems.name,
      description: menuItems.description,
      priceCents: menuItems.priceCents,
      category: menuItems.category,
      imageUrl: menuItems.imageUrl,
      i18n: menuItems.i18nTranslations,
      available: menuItems.available,
    })
    .from(menuItems)
    .where(eq(menuItems.tenantId, tenantId));

  const visible = items.filter((i) => i.available);
  const missing: SourceItem[] = visible
    .filter((i) => !pickFromI18n(i.i18n, lang)?.name)
    .map((i) => ({
      id: i.id,
      kind: "item",
      name: i.name,
      description: i.description,
    }));

  if (missing.length > 0) {
    try {
      const apiKey = await resolveAnthropicApiKey();
      const translations = await translateBatch(apiKey, lang, missing);
      const byId = new Map(translations.map((t) => [t.id, t]));
      // Persiste cada traducción en su fila usando jsonb_set.
      await Promise.all(
        translations.map((t) =>
          db
            .update(menuItems)
            .set({
              i18nTranslations: sql`jsonb_set(${menuItems.i18nTranslations}, ${"{" + lang + "}"}, ${JSON.stringify(
                { name: t.name, description: t.description ?? "" },
              )}::jsonb, true)`,
            })
            .where(eq(menuItems.id, t.id)),
        ),
      );
      // Reflejar in-memory.
      for (const i of visible) {
        const got = byId.get(i.id);
        if (got) {
          const m = (i.i18n as I18nMap | null) ?? {};
          m[lang] = { name: got.name, description: got.description };
          i.i18n = m;
        }
      }
    } catch {
      // Si Anthropic falla, devolvemos la carta canónica ES como fallback.
    }
  }

  const out = visible.map((i) => {
    const got = pickFromI18n(i.i18n, lang);
    return {
      id: i.id,
      name: got?.name ?? i.name,
      description: got?.description ?? i.description,
      priceCents: i.priceCents,
      category: i.category,
      imageUrl: i.imageUrl,
    };
  });
  return { items: out };
}

/** Para el comandero / KDS: SIEMPRE devuelve canónico ES. */
export async function getCanonicalMenu(tenantId: string) {
  return db
    .select({
      id: menuItems.id,
      name: menuItems.name,
      description: menuItems.description,
      priceCents: menuItems.priceCents,
      category: menuItems.category,
      imageUrl: menuItems.imageUrl,
      available: menuItems.available,
    })
    .from(menuItems)
    .where(eq(menuItems.tenantId, tenantId));
}

// Re-exporta tablas para que callers pasen tipos sin tocar schema directo.
export { menuItemModifierGroups, menuItemModifiers };
