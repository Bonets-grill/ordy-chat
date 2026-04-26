#!/usr/bin/env -S pnpm dlx tsx
import { neon } from "@neondatabase/serverless";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../..");
const envPath = [resolve(repoRoot, "web/.env.local"), resolve(process.cwd(), ".env.local")].find(existsSync);
if (!envPath) { console.error("FATAL: no .env.local"); process.exit(1); }
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["'](.*)["']$/, "$1");
}
const sql = neon(process.env.DATABASE_URL!);

async function main() {
const stats = await sql`
  SELECT
    (SELECT slug FROM tenants WHERE slug NOT LIKE 'mock-%' AND name ILIKE '%bonets%' LIMIT 1) as bonets_slug,
    (SELECT count(*)::int FROM orders WHERE is_test=false AND tenant_id IN (SELECT id FROM tenants WHERE slug NOT LIKE 'mock-%')) as bonets_orders_real,
    (SELECT count(*)::int FROM tenants WHERE slug NOT LIKE 'mock-%') as real_tenants,
    (SELECT count(*)::int FROM tenants WHERE slug LIKE 'mock-%') as mock_tenants,
    (SELECT count(*)::int FROM orders WHERE is_test=true AND tenant_id IN (SELECT id FROM tenants WHERE slug LIKE 'mock-%')) as mock_orders,
    (SELECT count(*)::int FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.is_test=true AND o.tenant_id IN (SELECT id FROM tenants WHERE slug LIKE 'mock-%')) as mock_items,
    (SELECT count(*)::int FROM appointments WHERE is_test=true AND tenant_id IN (SELECT id FROM tenants WHERE slug LIKE 'mock-%')) as mock_appts,
    (SELECT count(*)::int FROM shifts WHERE tenant_id IN (SELECT id FROM tenants WHERE slug LIKE 'mock-%') AND closed_at IS NULL) as mock_open_shifts,
    (SELECT count(*)::int FROM orders WHERE is_test=true AND status='pending' AND tenant_id IN (SELECT id FROM tenants WHERE slug LIKE 'mock-%')) as mock_kds_pending,
    (SELECT count(*)::int FROM orders WHERE is_test=true AND paid_at IS NOT NULL AND tenant_id IN (SELECT id FROM tenants WHERE slug LIKE 'mock-%')) as mock_paid
`;
console.log(JSON.stringify(stats[0], null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
