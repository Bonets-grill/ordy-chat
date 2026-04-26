#!/usr/bin/env -S pnpm dlx tsx
// scripts/cleanup-mock-tenants.ts — borra todo lo creado por seed-mock-tenants
// y load-mock-day. Bonets Grill (slug != mock-*) NO se toca.
//
// Uso:
//   pnpm tsx scripts/cleanup-mock-tenants.ts            # solo orders+appts (fast)
//   pnpm tsx scripts/cleanup-mock-tenants.ts --full     # también tenants+menu+tables+users+shifts

import { neon } from "@neondatabase/serverless";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(__filename, "../..");
const envPath = [
  resolve(repoRoot, "web/.env.local"),
  resolve(process.cwd(), ".env.local"),
].find((p) => existsSync(p));
if (!envPath) { console.error("FATAL: no .env.local"); process.exit(1); }
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
  if (!m || process.env[m[1]] !== undefined) continue;
  process.env[m[1]] = m[2].replace(/^["'](.*)["']$/, "$1");
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("FATAL: DATABASE_URL"); process.exit(1); }
const sql = neon(DATABASE_URL);

const FULL = process.argv.includes("--full");

async function main() {
  console.log(`→ Cleanup mock tenants (${FULL ? "FULL" : "orders+appts only"})…`);

  // 1) Orders is_test=true de tenants mock — order_items cae en cascade.
  const o = await sql`
    DELETE FROM orders
    WHERE is_test = true
      AND tenant_id IN (SELECT id FROM tenants WHERE slug LIKE 'mock-%')
  `;
  console.log("  orders deleted:", (o as { count?: number }).count ?? "n/a");

  // 2) Appointments is_test=true.
  const a = await sql`
    DELETE FROM appointments
    WHERE is_test = true
      AND tenant_id IN (SELECT id FROM tenants WHERE slug LIKE 'mock-%')
  `;
  console.log("  appts deleted:", (a as { count?: number }).count ?? "n/a");

  if (FULL) {
    // 3) Shifts (incluso cerrados).
    const s = await sql`
      DELETE FROM shifts
      WHERE tenant_id IN (SELECT id FROM tenants WHERE slug LIKE 'mock-%')
    `;
    console.log("  shifts deleted:", (s as { count?: number }).count ?? "n/a");

    // 4) Tenants — cascade limpia menu_items, tables, agent_configs,
    //    tenant_members.
    const t = await sql`
      DELETE FROM tenants WHERE slug LIKE 'mock-%'
    `;
    console.log("  tenants deleted:", (t as { count?: number }).count ?? "n/a");

    // 5) Users mock owner.
    const u = await sql`
      DELETE FROM users WHERE email LIKE 'owner+mock-%@mock.ordy.test'
    `;
    console.log("  users deleted:", (u as { count?: number }).count ?? "n/a");
  }

  // Verify.
  const remaining = (await sql`
    SELECT
      (SELECT count(*)::int FROM orders WHERE is_test = true AND tenant_id IN (SELECT id FROM tenants WHERE slug LIKE 'mock-%')) as orders,
      (SELECT count(*)::int FROM appointments WHERE is_test = true AND tenant_id IN (SELECT id FROM tenants WHERE slug LIKE 'mock-%')) as appts,
      (SELECT count(*)::int FROM tenants WHERE slug LIKE 'mock-%') as tenants
  `) as Array<{ orders: number; appts: number; tenants: number }>;
  console.log("DB after cleanup:", remaining[0]);
}

main().catch((e) => { console.error(e); process.exit(1); });
