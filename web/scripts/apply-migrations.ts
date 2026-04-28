#!/usr/bin/env -S pnpm dlx tsx
// web/scripts/apply-migrations.ts — aplicador idempotente de migraciones SQL
// con tracking en applied_migrations + drift detection por sha256.
//
// Patrón:
//   1. Lee shared/migrations/NNN_*.sql (excluye .rollback.sql) en orden.
//   2. Para cada uno:
//        - Calcula sha256 del contenido
//        - SELECT FROM applied_migrations WHERE name=?
//        - Si no existe          → BEGIN; ejecutar SQL; INSERT row; COMMIT
//        - Si existe + sha igual → skip
//        - Si existe + sha distinto → ABORT con drift error
//   3. Bootstrap: si la tabla applied_migrations no existe, la crea
//      ejecutando primero la mig 058. Si tras eso la tabla está vacía
//      y hay >1 archivo (caso prod ya tiene mig 001-057 aplicadas
//      a mano), backfill SOLO esas con applied_at=NULL.
//
// Uso:
//   pnpm tsx web/scripts/apply-migrations.ts              # apply pending
//   pnpm tsx web/scripts/apply-migrations.ts --dry        # plan only
//   pnpm tsx web/scripts/apply-migrations.ts --status     # list state per mig
//
// Salida fail-fast: cualquier error → exit 1, NO continúa con siguientes.

import { neon } from "@neondatabase/serverless";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Carga .env.local manualmente (mismo patrón que el resto de scripts).
const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(__filename, "../../..");
const envPath = [
  resolve(repoRoot, "web/.env.local"),
  resolve(process.cwd(), ".env.local"),
].find((p) => existsSync(p));
if (!envPath) {
  console.error("FATAL: no se encontró .env.local");
  process.exit(1);
}
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
  if (!m || process.env[m[1]] !== undefined) continue;
  process.env[m[1]] = m[2].replace(/^["'](.*)["']$/, "$1");
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("FATAL: DATABASE_URL no definido");
  process.exit(1);
}

const DRY = process.argv.includes("--dry");
const STATUS_ONLY = process.argv.includes("--status");
const APPLIED_BY = process.env.USER || process.env.GITHUB_ACTOR || "unknown";

const sql = neon(DATABASE_URL);
const migrationsDir = resolve(repoRoot, "shared/migrations");

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function listForwardMigrations(): { name: string; path: string; content: string; sha: string }[] {
  if (!existsSync(migrationsDir)) {
    console.error(`FATAL: ${migrationsDir} no existe`);
    process.exit(1);
  }
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql") && !f.endsWith(".rollback.sql"))
    .sort()
    .map((name) => {
      const path = resolve(migrationsDir, name);
      const content = readFileSync(path, "utf8");
      return { name, path, content, sha: sha256(content) };
    });
}

async function trackingTableExists(): Promise<boolean> {
  const r = await sql`
    SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='applied_migrations'
  ` as { "?column?": number }[];
  return r.length > 0;
}

async function getAppliedMap(): Promise<Map<string, string>> {
  const rows = await sql`SELECT name, sha256 FROM applied_migrations` as { name: string; sha256: string }[];
  return new Map(rows.map((r) => [r.name, r.sha256]));
}

function execSqlFile(path: string): void {
  // Neon serverless HTTP no soporta multi-statement ni plpgsql ($$...$$).
  // Delegamos a `psql -f` que sí. Requiere `psql` en PATH (Homebrew lo
  // instala en /opt/homebrew/bin). DATABASE_URL ya está cargado en env.
  const r = spawnSync(
    "psql",
    [process.env.DATABASE_URL!, "-v", "ON_ERROR_STOP=1", "-q", "-f", path],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  if (r.status !== 0) {
    throw new Error(
      `psql falló (exit=${r.status}): ${r.stderr?.toString().trim() || "unknown"}`,
    );
  }
}

async function applyOne(name: string, path: string, sha: string) {
  if (DRY) {
    console.log(`  [DRY] ejecutaría: ${name} (sha=${sha.slice(0, 12)})`);
    return;
  }
  execSqlFile(path);
  await sql`
    INSERT INTO applied_migrations (name, sha256, applied_at, applied_by)
    VALUES (${name}, ${sha}, now(), ${APPLIED_BY})
    ON CONFLICT (name) DO UPDATE SET sha256 = EXCLUDED.sha256, applied_at = now(), applied_by = EXCLUDED.applied_by
  `;
}

async function bootstrap(allMigrations: ReturnType<typeof listForwardMigrations>) {
  console.log("→ Bootstrap: tabla applied_migrations no existe.");
  const mig058 = allMigrations.find((m) => m.name.startsWith("058_"));
  if (!mig058) {
    console.error("FATAL: bootstrap requiere mig 058_migrations_tracking.sql");
    process.exit(1);
  }
  if (DRY) {
    console.log("  [DRY] crearía tabla y backfill mig 001-057 con applied_at=NULL");
    return;
  }
  console.log("  → ejecutando mig 058 (CREATE TABLE applied_migrations)");
  execSqlFile(mig058.path);

  // Backfill: todas las mig estrictamente anteriores a 058 se asumen ya
  // aplicadas a mano en prod. applied_at=NULL marca "legacy untracked".
  const legacy = allMigrations.filter((m) => m.name < "058_");
  console.log(`  → backfilling ${legacy.length} mig legacy (applied_at=NULL)`);
  for (const m of legacy) {
    await sql`
      INSERT INTO applied_migrations (name, sha256, applied_at, applied_by)
      VALUES (${m.name}, ${m.sha}, NULL, 'backfill')
      ON CONFLICT (name) DO NOTHING
    `;
  }
  // La 058 también la registramos como aplicada AHORA (acabamos de ejecutarla).
  await sql`
    INSERT INTO applied_migrations (name, sha256, applied_at, applied_by)
    VALUES (${mig058.name}, ${mig058.sha}, now(), ${APPLIED_BY})
    ON CONFLICT (name) DO UPDATE SET sha256=EXCLUDED.sha256, applied_at=now(), applied_by=EXCLUDED.applied_by
  `;
  console.log("  ✅ bootstrap completo");
}

async function main() {
  const all = listForwardMigrations();
  console.log(`→ ${all.length} migraciones forward en disco`);

  const needsBootstrap = !(await trackingTableExists());
  if (needsBootstrap) {
    await bootstrap(all);
  }

  // En dry-run + bootstrap necesario, la tabla no existe aún → tratamos
  // todo como "pending sin tocar DB". En modo real ya está creada arriba.
  const applied =
    DRY && needsBootstrap ? new Map<string, string>() : await getAppliedMap();

  if (STATUS_ONLY) {
    console.log("\nname                                      | sha (file)  | sha (db)    | state");
    console.log("------------------------------------------+-------------+-------------+------------");
    for (const m of all) {
      const dbSha = applied.get(m.name);
      let state: string;
      if (!dbSha) state = "🆕 PENDING";
      else if (dbSha === m.sha) state = "✅ applied";
      else state = "🚨 DRIFT";
      const dbShaShort = dbSha ? dbSha.slice(0, 11) : "—";
      console.log(`${m.name.padEnd(42)}| ${m.sha.slice(0, 11)} | ${dbShaShort.padEnd(11)} | ${state}`);
    }
    return;
  }

  let appliedCount = 0;
  let skipped = 0;
  let drift = 0;
  for (const m of all) {
    const dbSha = applied.get(m.name);
    if (!dbSha) {
      console.log(`→ APPLY ${m.name} (sha=${m.sha.slice(0, 12)})`);
      try {
        await applyOne(m.name, m.content, m.sha);
        appliedCount++;
      } catch (e) {
        console.error(`🚨 FAIL ${m.name}: ${(e as Error).message}`);
        process.exit(1);
      }
    } else if (dbSha === m.sha) {
      skipped++;
    } else {
      console.error(
        `🚨 DRIFT ${m.name}: sha en disco=${m.sha.slice(0, 12)} ≠ sha en DB=${dbSha.slice(0, 12)}.\n` +
          `   El archivo se modificó después de aplicarse. ABORT.`,
      );
      drift++;
    }
  }

  console.log(`\n=== Resumen ===`);
  console.log(`  applied: ${appliedCount}`);
  console.log(`  skipped: ${skipped}`);
  console.log(`  drift  : ${drift}`);
  if (drift > 0) {
    console.error("FAIL: drift detectado. Resolver antes de continuar.");
    process.exit(1);
  }
  console.log(DRY ? "(dry-run, nada aplicado)" : "✅ done");
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
