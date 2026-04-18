// web/scripts/regenerate-all-prompts.ts — Regenera el system_prompt de todos
// los tenants tras cambios en buildSystemPrompt o en schema de FAQs/pagos.
//
// Uso:
//   pnpm tsx scripts/regenerate-all-prompts.ts

import { db } from "@/lib/db";
import { tenants } from "@/lib/db/schema";
import { regenerateTenantPrompt } from "@/lib/prompt-regen";

async function main() {
  const rows = await db.select({ id: tenants.id, slug: tenants.slug, name: tenants.name }).from(tenants);
  console.log(`Regenerating prompts for ${rows.length} tenants…`);
  let ok = 0;
  for (const t of rows) {
    try {
      await regenerateTenantPrompt(t.id);
      console.log(`  ✓ ${t.slug} (${t.name})`);
      ok++;
    } catch (e) {
      console.error(`  ✗ ${t.slug}: ${e instanceof Error ? e.message : e}`);
    }
  }
  console.log(`Done: ${ok}/${rows.length}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
