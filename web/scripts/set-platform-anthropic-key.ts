// scripts/set-platform-anthropic-key.ts
//
// Persiste la `ANTHROPIC_API_KEY` global cifrada en `platform_settings`.
// Misma rama de cifrado que usa `/admin/settings` (AES-256-GCM con
// `ENCRYPTION_KEY`), para que tanto runtime (Python) como web (Next) la
// resuelvan via `obtener_anthropic_api_key` / `resolveAnthropicApiKey`.
//
// La key se lee de `process.env.NEW_ANTHROPIC_KEY` para no dejarla nunca
// en el repo. Uso:
//
//   NEW_ANTHROPIC_KEY=sk-ant-... pnpm tsx scripts/set-platform-anthropic-key.ts
//
// Verificación: re-lee la fila, descifra, e imprime `prefix=sk-ant-... len=N`.

import { sql as drizzleSql } from "drizzle-orm";
import { cifrar, descifrar } from "../lib/crypto";
import { db } from "../lib/db";

async function main() {
  const newKey = process.env.NEW_ANTHROPIC_KEY?.trim();
  if (!newKey) {
    console.error("✗ Falta NEW_ANTHROPIC_KEY en el entorno.");
    process.exit(1);
  }
  if (!newKey.startsWith("sk-ant-")) {
    console.error("✗ NEW_ANTHROPIC_KEY no parece una API key de Anthropic (debe empezar por 'sk-ant-').");
    process.exit(1);
  }

  const ciphertext = cifrar(newKey);

  // UPSERT directo (la tabla tiene PK en `key`).
  await db.execute(drizzleSql`
    INSERT INTO platform_settings (key, value_encrypted, updated_at)
    VALUES ('anthropic_api_key', ${ciphertext}, NOW())
    ON CONFLICT (key) DO UPDATE
      SET value_encrypted = EXCLUDED.value_encrypted,
          updated_at = NOW()
  `);

  // Verificación: leemos de vuelta y descifrarnos.
  const rows = await db.execute<{ value_encrypted: string; updated_at: string }>(drizzleSql`
    SELECT value_encrypted, updated_at::text AS updated_at
    FROM platform_settings WHERE key='anthropic_api_key' LIMIT 1
  `);
  const row = (rows as unknown as { rows?: Array<{ value_encrypted: string; updated_at: string }> }).rows?.[0]
    ?? (rows as unknown as Array<{ value_encrypted: string; updated_at: string }>)[0];
  if (!row) {
    console.error("✗ UPSERT pareció ir bien pero no se pudo releer la fila.");
    process.exit(1);
  }
  const decrypted = descifrar(row.value_encrypted);
  if (decrypted !== newKey) {
    console.error("✗ Round-trip cifrar→descifrar NO coincide. Aborta.");
    process.exit(1);
  }

  console.log("✓ platform_settings.anthropic_api_key persistida y verificada.");
  console.log(`  prefix=${decrypted.slice(0, 12)}... len=${decrypted.length}`);
  console.log(`  updated_at=${row.updated_at}`);
  console.log(`  ciphertext_len=${row.value_encrypted.length} (b64)`);
}

main().catch((e) => {
  console.error("✗ Error:", e);
  process.exit(1);
});
