// web/lib/anthropic-key.ts — Resolución de ANTHROPIC_API_KEY global.
//
// Precedencia:
//   1. process.env.ANTHROPIC_API_KEY (dev local)
//   2. platform_settings.value_encrypted WHERE key='anthropic_api_key' (super admin)
// Lanza si ninguno disponible. Retorna key plain.
//
// Patrón idéntico al que usa lib/scraper/extract.ts — aquí lo extraemos a
// módulo reutilizable para evitar duplicación entre features.

import { eq } from "drizzle-orm";
import { descifrar } from "@/lib/crypto";
import { db } from "@/lib/db";
import { platformSettings } from "@/lib/db/schema";

export class AnthropicKeyMissingError extends Error {
  constructor(msg = "ANTHROPIC_API_KEY no configurada (ni env ni platform_settings)") {
    super(msg);
    this.name = "AnthropicKeyMissingError";
  }
}

export async function resolveAnthropicApiKey(): Promise<string> {
  const envKey = process.env.ANTHROPIC_API_KEY;
  if (envKey) return envKey;
  const [row] = await db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.key, "anthropic_api_key"))
    .limit(1);
  if (row?.valueEncrypted) {
    try {
      return descifrar(row.valueEncrypted);
    } catch {
      // fall through
    }
  }
  throw new AnthropicKeyMissingError();
}
