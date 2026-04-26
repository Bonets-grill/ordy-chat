#!/usr/bin/env -S pnpm dlx tsx
// scripts/seed-mock-tenants.ts — crea N tenants mock para smoke ultra-robusto.
//
// Mario 2026-04-26: 200 tenants funcionando como un día normal para ver si el
// sistema aguanta. Bonets Grill (slug != mock-*) NO se toca. Todos los datos
// que generen tendrán is_test=true en orders/appointments.
//
// Uso: pnpm dlx tsx scripts/seed-mock-tenants.ts [count=200]
// Idempotente: si un slug ya existe, lo reutiliza sin duplicar.

import { neon } from "@neondatabase/serverless";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Carga .env.local del web/. Robusto al cwd: busca primero web/.env.local,
// luego .env.local (si script se invoca desde web/).
const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(__filename, "../..");
const candidates = [
  resolve(repoRoot, "web/.env.local"),
  resolve(process.cwd(), ".env.local"),
  resolve(process.cwd(), "web/.env.local"),
];
const envPath = candidates.find((p) => existsSync(p));
if (!envPath) {
  console.error("FATAL: no .env.local encontrado en", candidates);
  process.exit(1);
}
console.log(`→ Cargando env desde ${envPath}`);
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
  if (!m || process.env[m[1]] !== undefined) continue;
  process.env[m[1]] = m[2].replace(/^["'](.*)["']$/, "$1");
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("FATAL: DATABASE_URL missing");
  process.exit(1);
}
const sql = neon(DATABASE_URL);

const COUNT = Number(process.argv[2] ?? 200);

const BUSINESS_TYPES = [
  "Bar de la Esquina", "Pizzería Italia", "Hamburguesería La Brasa",
  "Tasca El Lagar", "Asador Don Pepe", "Sushi Tokyo", "Mexicano El Charro",
  "Restaurante Mediterráneo", "Cafetería Aroma", "Cervecería Lúpulo",
  "Café Literario", "Brasería La Parrilla", "Tapas y Vinos", "Marisquería Mar",
  "Ramen House", "Indio Curry", "Vegano Verde", "Crepería Dulce",
];

const CITIES = ["Madrid", "Barcelona", "Valencia", "Sevilla", "Zaragoza", "Málaga", "Bilbao", "Granada", "Tenerife", "Las Palmas"];
const TIMEZONES = ["Europe/Madrid", "Europe/Madrid", "Europe/Madrid", "Europe/Madrid", "Atlantic/Canary"];
const TAX_REGIONS_BY_TZ: Record<string, string> = {
  "Europe/Madrid": "es_peninsula",
  "Atlantic/Canary": "es_canarias",
};

const MENU_ITEMS_TEMPLATE = [
  { category: "Entrantes", name: "Croquetas caseras", priceCents: 800 },
  { category: "Entrantes", name: "Patatas bravas", priceCents: 650 },
  { category: "Entrantes", name: "Ensalada César", priceCents: 950 },
  { category: "Principales", name: "Hamburguesa Clásica", priceCents: 1290 },
  { category: "Principales", name: "Pizza Margarita", priceCents: 1090 },
  { category: "Principales", name: "Solomillo a la pimienta", priceCents: 1890 },
  { category: "Principales", name: "Pollo al ajillo", priceCents: 1290 },
  { category: "Principales", name: "Pasta Carbonara", priceCents: 1190 },
  { category: "Postres", name: "Tarta de queso", priceCents: 590 },
  { category: "Postres", name: "Tiramisú", priceCents: 590 },
  { category: "Bebidas", name: "Coca-Cola", priceCents: 290 },
  { category: "Bebidas", name: "Cerveza caña", priceCents: 250 },
  { category: "Bebidas", name: "Vino tinto copa", priceCents: 380 },
];

function pad(n: number, len = 3) {
  return n.toString().padStart(len, "0");
}

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

async function seedOne(i: number) {
  const slug = `mock-${pad(i)}`;
  const tz = randomFrom(TIMEZONES);
  const taxRegion = TAX_REGIONS_BY_TZ[tz] ?? "es_peninsula";
  const businessName = `${randomFrom(BUSINESS_TYPES)} ${pad(i)}`;
  const city = randomFrom(CITIES);
  const email = `owner+${slug}@mock.ordy.test`;

  // 1) User owner (idempotent por email).
  const existingUser = (await sql`
    SELECT id FROM users WHERE email = ${email} LIMIT 1
  `) as Array<{ id: string }>;
  let userId = existingUser[0]?.id;
  if (!userId) {
    const inserted = (await sql`
      INSERT INTO users (email, name, role)
      VALUES (${email}, ${`Owner ${pad(i)}`}, 'tenant_admin')
      RETURNING id
    `) as Array<{ id: string }>;
    userId = inserted[0]!.id;
  }

  // 2) Tenant (idempotent por slug).
  const existingTenant = (await sql`
    SELECT id FROM tenants WHERE slug = ${slug} LIMIT 1
  `) as Array<{ id: string }>;
  let tenantId = existingTenant[0]?.id;
  if (!tenantId) {
    const inserted = (await sql`
      INSERT INTO tenants (
        slug, name, owner_user_id, subscription_status, trial_ends_at,
        timezone, tax_region, billing_city, billing_country
      )
      VALUES (
        ${slug}, ${businessName}, ${userId}, 'trialing',
        NOW() + interval '30 days',
        ${tz}, ${taxRegion}, ${city}, 'ES'
      )
      RETURNING id
    `) as Array<{ id: string }>;
    tenantId = inserted[0]!.id;

    // tenant_members owner.
    await sql`
      INSERT INTO tenant_members (tenant_id, user_id, role)
      VALUES (${tenantId}, ${userId}, 'owner')
      ON CONFLICT DO NOTHING
    `;
  }

  // 3) agent_config (PK = tenantId).
  await sql`
    INSERT INTO agent_configs (
      tenant_id, business_name, business_description, agent_name, tone,
      schedule, system_prompt, fallback_message, error_message,
      onboarding_completed, menu_pending
    ) VALUES (
      ${tenantId}, ${businessName},
      ${`Mock ${city} smoke test 200-tenants 2026-04-26.`},
      'Asistente', 'friendly',
      '24/7',
      ${`Eres el agente del restaurante ${businessName}. Responde con amabilidad. Recoge pedidos y reservas.`},
      'Disculpa, no entendí. ¿Quieres pedir algo, hacer una reserva o hablar con alguien?',
      'Lo siento, hubo un error. Te paso con un humano.',
      true, false
    )
    ON CONFLICT (tenant_id) DO NOTHING
  `;

  // 4) menu_items — 8 items random (subset del template).
  const existingMenu = (await sql`
    SELECT count(*)::int as n FROM menu_items WHERE tenant_id = ${tenantId}
  `) as Array<{ n: number }>;
  if ((existingMenu[0]?.n ?? 0) === 0) {
    const sample = MENU_ITEMS_TEMPLATE.slice().sort(() => Math.random() - 0.5).slice(0, 8);
    for (let idx = 0; idx < sample.length; idx++) {
      const item = sample[idx]!;
      await sql`
        INSERT INTO menu_items (tenant_id, category, name, price_cents, sort_order, source)
        VALUES (${tenantId}, ${item.category}, ${item.name}, ${item.priceCents}, ${idx}, 'manual')
      `;
    }
  }

  // 5) restaurant_tables — 5 mesas T1..T5.
  const existingTables = (await sql`
    SELECT count(*)::int as n FROM restaurant_tables WHERE tenant_id = ${tenantId}
  `) as Array<{ n: number }>;
  if ((existingTables[0]?.n ?? 0) === 0) {
    for (let t = 1; t <= 5; t++) {
      await sql`
        INSERT INTO restaurant_tables (tenant_id, number, seats, sort_order)
        VALUES (${tenantId}, ${`T${t}`}, ${t === 5 ? 6 : 4}, ${t})
      `;
    }
  }

  return { tenantId, slug };
}

async function main() {
  const t0 = Date.now();
  console.log(`→ Seed ${COUNT} mock tenants (idempotent)…`);

  const BATCH = 10;
  let done = 0;
  let failed = 0;
  for (let start = 1; start <= COUNT; start += BATCH) {
    const batch = [];
    for (let i = start; i < start + BATCH && i <= COUNT; i++) batch.push(i);
    const results = await Promise.allSettled(batch.map(seedOne));
    for (const r of results) {
      if (r.status === "fulfilled") done++;
      else { failed++; console.error("✗", r.reason instanceof Error ? r.reason.message.slice(0, 200) : r.reason); }
    }
    if (start % 50 === 1 || done === COUNT) console.log(`  ${done}/${COUNT}…`);
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`✓ Seed done: ${done} ok, ${failed} failed, ${elapsed}s`);

  // Verificación.
  const stats = (await sql`
    SELECT
      (SELECT count(*)::int FROM tenants WHERE slug LIKE 'mock-%') as tenants,
      (SELECT count(*)::int FROM agent_configs WHERE tenant_id IN (SELECT id FROM tenants WHERE slug LIKE 'mock-%')) as configs,
      (SELECT count(*)::int FROM menu_items WHERE tenant_id IN (SELECT id FROM tenants WHERE slug LIKE 'mock-%')) as menu,
      (SELECT count(*)::int FROM restaurant_tables WHERE tenant_id IN (SELECT id FROM tenants WHERE slug LIKE 'mock-%')) as tables
  `) as Array<{ tenants: number; configs: number; menu: number; tables: number }>;
  console.log("DB verification:", stats[0]);
}

main().catch((e) => { console.error(e); process.exit(1); });
