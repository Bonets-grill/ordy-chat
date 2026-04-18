// web/scripts/migrate-tenant-tax-by-postal-code.ts
// Migra cada tenant a su régimen fiscal correcto en base a billing_postal_code.
//
// Reglas:
//   - CP empieza por 35 o 38 → Canarias → IGIC 7/20
//   - CP empieza por 51 o 52 → Ceuta/Melilla → IPSI 4/8
//   - Otro CP ES válido → Península → IVA 10/21
//   - CP NULL/inválido → Península fallback + log explícito
//
// Ejecución:
//   pnpm tsx --env-file=.env.local scripts/migrate-tenant-tax-by-postal-code.ts        # dry-run
//   pnpm tsx --env-file=.env.local scripts/migrate-tenant-tax-by-postal-code.ts --yes  # aplicar

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tenants } from "@/lib/db/schema";
import { regenerateTenantPrompt } from "@/lib/prompt-regen";
import { TAX_PRESETS, postalCodeToRegion } from "@/lib/tax/presets";

async function main() {
  const isConfirmed = process.argv.includes("--yes");
  console.log(isConfirmed ? "✓ MODO CONFIRMADO" : "👀 DRY-RUN");
  console.log("");

  const all = await db.select().from(tenants);
  console.log(`Tenants a evaluar: ${all.length}`);
  console.log("");

  let willChange = 0;
  let nullCp = 0;
  const plan: Array<{ id: string; slug: string; from: string; to: string; cp: string | null; system: string }> = [];

  for (const t of all) {
    const region = postalCodeToRegion(t.billingPostalCode);
    if (!t.billingPostalCode) nullCp++;
    if (t.taxRegion === region) continue;
    plan.push({
      id: t.id,
      slug: t.slug,
      from: t.taxRegion,
      to: region,
      cp: t.billingPostalCode,
      system: TAX_PRESETS[region].system,
    });
    willChange++;
  }

  console.log(`Cambiarían de región: ${willChange}`);
  console.log(`Tenants sin CP (fallback a 'es_peninsula'): ${nullCp}`);
  console.log("");

  for (const p of plan.slice(0, 20)) {
    console.log(`  · ${p.slug}  cp=${p.cp ?? "∅"}  ${p.from} → ${p.to} (${p.system})`);
  }
  if (plan.length > 20) console.log(`  … (${plan.length - 20} más)`);
  console.log("");

  if (!isConfirmed) {
    console.log("Re-ejecuta con --yes para aplicar los cambios.");
    process.exit(0);
  }

  let updated = 0;
  let promptsRegen = 0;
  for (const p of plan) {
    const preset = TAX_PRESETS[p.to as keyof typeof TAX_PRESETS];
    await db
      .update(tenants)
      .set({
        taxRegion: p.to,
        taxSystem: preset.system,
        taxLabel: preset.label,
        taxRateStandard: String(preset.standard.toFixed(2)),
        taxRateAlcohol: String(preset.alcohol.toFixed(2)),
        pricesIncludeTax: preset.pricesIncludeTax,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, p.id));
    updated++;

    try {
      await regenerateTenantPrompt(p.id);
      promptsRegen++;
    } catch (e) {
      console.error(`  ⚠ ${p.slug}: no se pudo regenerar prompt — ${e instanceof Error ? e.message : e}`);
    }
  }

  console.log(`✓ Actualizados ${updated} tenants.`);
  console.log(`✓ Prompts regenerados: ${promptsRegen}/${updated}.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
