// lib/scraper/extract.ts — Extrae datos estructurados usando Claude.

import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { descifrar } from "@/lib/crypto";
import { db } from "@/lib/db";
import { platformSettings } from "@/lib/db/schema";

export type ExtractedBusiness = {
  name?: string;
  description?: string;
  phone?: string;
  email?: string;
  address?: string;
  hours?: string;
  website?: string;
  social?: Record<string, string>;
};

export type ExtractedItem = {
  name: string;
  description?: string;
  price?: string;
  allergens?: string[];
  modifiers?: { name: string; options: string[] }[];
};

export type ExtractedCategory = {
  name: string;
  description?: string;
  items: ExtractedItem[];
};

export type ExtractedData = {
  business: ExtractedBusiness;
  categories: ExtractedCategory[];
  faqs?: { question: string; answer: string }[];
  notes?: string;
};

const SYSTEM_PROMPT = `Eres un extractor de datos de negocios. Recibes texto y JSON-LD scrappeados de la web de un negocio.

Tu tarea: devolver un único objeto JSON con exactamente esta estructura (omite campos vacíos, NO inventes datos):

{
  "business": {
    "name": string,
    "description": string (2-3 frases),
    "phone": string,
    "email": string,
    "address": string,
    "hours": string (formato humano: "Lun-Vie 9:00-22:00, Sab-Dom 10:00-23:00"),
    "website": string,
    "social": { "instagram": string, "facebook": string, "twitter": string, "tiktok": string }
  },
  "categories": [
    {
      "name": string,
      "description": string,
      "items": [
        {
          "name": string,
          "description": string,
          "price": string (con símbolo € si aplica),
          "allergens": string[],
          "modifiers": [{ "name": string, "options": string[] }]
        }
      ]
    }
  ],
  "faqs": [{ "question": string, "answer": string }],
  "notes": string (cualquier info adicional relevante)
}

REGLAS:
- SOLO JSON válido, nada más. Sin comentarios, sin markdown.
- Si un campo no se encuentra en el texto, OMÍTELO (no pongas null, vacío o "N/A").
- Precios: respeta exactamente como aparecen (€12,50 / 12.50 EUR / etc.).
- Alérgenos: lista en minúsculas ("gluten", "lactosa", "frutos secos", etc.).
- Si el negocio NO es de restauración, deja categories: [] y pon toda la oferta en notes.
- No traduzcas: respeta el idioma original del texto.`;

export async function extractWithClaude(consolidatedText: string): Promise<ExtractedData> {
  const apiKey = await resolveApiKey();
  const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 60_000 });

  // Trunca a ~150k chars para no rebasar ventana; Claude Sonnet 4.6 maneja mucho más pero cuesta.
  const input = consolidatedText.length > 150_000
    ? consolidatedText.slice(0, 150_000) + "\n\n[truncated]"
    : consolidatedText;

  const resp = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: `Extrae datos estructurados del siguiente contenido scrappeado. Responde SOLO con el JSON:\n\n${input}`,
      },
    ],
  });

  const text = resp.content[0]?.type === "text" ? resp.content[0].text : "";
  const json = extractJsonFromText(text);
  if (!json) throw new Error("Claude no devolvió JSON válido");
  return normalize(json);
}

function extractJsonFromText(text: string): Record<string, unknown> | null {
  // Si viene envuelto en ```json ... ```, lo quita.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fenced ? fenced[1] : text;
  try {
    return JSON.parse(candidate);
  } catch {
    // Último intento: encontrar primer { y último }.
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch { /* fall through */ }
    }
    return null;
  }
}

function normalize(raw: Record<string, unknown>): ExtractedData {
  const business = (raw.business as ExtractedBusiness | undefined) ?? {};
  const categories = Array.isArray(raw.categories) ? (raw.categories as ExtractedCategory[]) : [];
  const faqs = Array.isArray(raw.faqs) ? (raw.faqs as { question: string; answer: string }[]) : undefined;
  const notes = typeof raw.notes === "string" ? (raw.notes as string) : undefined;
  return { business, categories, faqs, notes };
}

async function resolveApiKey(): Promise<string> {
  const envKey = process.env.ANTHROPIC_API_KEY;
  if (envKey) return envKey;
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, "anthropic_api_key")).limit(1);
  if (row?.valueEncrypted) {
    try { return descifrar(row.valueEncrypted); } catch { /* fall through */ }
  }
  throw new Error("ANTHROPIC_API_KEY no configurada (ni env ni platform_settings)");
}
