// web/lib/anthropic-key.ts — Resolución de ANTHROPIC_API_KEY global.
//
// Precedencia (clase mundial: el super admin controla rotación desde el panel,
// no desde infra; env queda como bootstrap/dev local):
//   1. platform_settings.value_encrypted WHERE key='anthropic_api_key'
//      (rotable 1-click desde /admin/settings, cifrado AES-256-GCM)
//   2. process.env.ANTHROPIC_API_KEY (dev local / bootstrap inicial)
// Lanza si ninguno disponible. Retorna key plain.

import { eq } from "drizzle-orm";
import { descifrar } from "@/lib/crypto";
import { db } from "@/lib/db";
import { platformSettings } from "@/lib/db/schema";

export class AnthropicKeyMissingError extends Error {
  constructor(msg = "ANTHROPIC_API_KEY no configurada (ni platform_settings ni env)") {
    super(msg);
    this.name = "AnthropicKeyMissingError";
  }
}

export async function resolveAnthropicApiKey(): Promise<string> {
  // 1. platform_settings (fuente de verdad — super admin la rota desde el panel)
  try {
    const [row] = await db
      .select()
      .from(platformSettings)
      .where(eq(platformSettings.key, "anthropic_api_key"))
      .limit(1);
    if (row?.valueEncrypted) {
      try {
        return descifrar(row.valueEncrypted);
      } catch {
        // descifrado falló (ENCRYPTION_KEY rotada?) → caemos a env como red de seguridad
      }
    }
  } catch {
    // DB no disponible (boot, migración) → caemos a env
  }
  // 2. env (fallback dev local / bootstrap inicial antes del primer set en panel)
  const envKey = process.env.ANTHROPIC_API_KEY;
  if (envKey) return envKey;
  throw new AnthropicKeyMissingError();
}
