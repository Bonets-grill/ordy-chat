#!/usr/bin/env -S pnpm dlx tsx
// scripts/load-mock-day.ts — simula un día completo de actividad sobre los
// 200 tenants mock para smoke ultra-robusto.
//
// Genera (todos is_test=true para no contaminar reportes Bonets):
//   - 1 shift abierto por tenant (auto-open simulado).
//   - ~30 orders por tenant (mix dine_in via QR + takeaway via WA bot + comandero).
//   - ~5 appointments (reservas) por tenant.
//   - Algunos pedidos via HTTP REAL (POST /api/orders con RUNTIME_INTERNAL_SECRET)
//     para probar el end-to-end completo bajo carga.
//
// Uso: pnpm tsx scripts/load-mock-day.ts [ordersPerTenant=30] [appointmentsPerTenant=5]

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
const RUNTIME_INTERNAL_SECRET = process.env.RUNTIME_INTERNAL_SECRET;
if (!DATABASE_URL) { console.error("FATAL: DATABASE_URL"); process.exit(1); }
const sql = neon(DATABASE_URL);

const PROD_BASE = "https://ordychat.ordysuite.com";
const ORDERS_PER_TENANT = Number(process.argv[2] ?? 30);
const APPOINTMENTS_PER_TENANT = Number(process.argv[3] ?? 5);

const ORDER_TYPES = ["dine_in", "takeaway"] as const;
const FAKE_NAMES = ["Ana", "Carlos", "María", "Juan", "Lucía", "Pedro", "Sofía", "Diego", "Elena", "Pablo"];

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function pick<T>(arr: readonly T[]): T {
  return arr[randInt(0, arr.length - 1)]!;
}
function fakePhone(): string {
  return "346" + String(randInt(10000000, 99999999));
}

type TenantRow = { id: string; slug: string; tax_rate: string };
type MenuRow = { id: string; name: string; price_cents: number };
type TableRow = { id: string; number: string };

async function ensureShift(tenantId: string): Promise<string> {
  const existing = (await sql`
    SELECT id FROM shifts
    WHERE tenant_id = ${tenantId} AND closed_at IS NULL
    LIMIT 1
  `) as Array<{ id: string }>;
  if (existing[0]) return existing[0].id;

  const created = (await sql`
    INSERT INTO shifts (tenant_id, opening_cash_cents, opened_by, auto_opened)
    VALUES (${tenantId}, 0, 'mock-load-test', true)
    RETURNING id
  `) as Array<{ id: string }>;
  return created[0]!.id;
}

async function loadOneTenant(tenant: TenantRow, idx: number) {
  // 1) Asegurar shift abierto.
  const shiftId = await ensureShift(tenant.id);

  // 2) Cargar menú + mesas.
  const menu = (await sql`
    SELECT id, name, price_cents FROM menu_items WHERE tenant_id = ${tenant.id} AND available = true
  `) as MenuRow[];
  const tables = (await sql`
    SELECT id, number FROM restaurant_tables WHERE tenant_id = ${tenant.id} AND active = true
  `) as TableRow[];

  if (menu.length === 0 || tables.length === 0) {
    return { ok: 0, fail: ORDERS_PER_TENANT, reason: "empty_menu_or_tables" };
  }

  // 3) Crear N orders mock — bulk INSERT por velocidad (saltamos createOrder
  //    porque generaríamos 6000 transacciones HTTP-equivalente). El sample
  //    HTTP real al final cubre el path completo.
  const taxRate = Number(tenant.tax_rate ?? "10");
  let okCount = 0;
  const startedAt = Date.now();

  for (let i = 0; i < ORDERS_PER_TENANT; i++) {
    try {
      const orderType = pick(ORDER_TYPES);
      const tableNumber = orderType === "dine_in" ? pick(tables).number : null;
      const customerName = orderType === "takeaway" ? pick(FAKE_NAMES) : null;
      const customerPhone = orderType === "takeaway" ? fakePhone() : null;
      // 1-3 items aleatorios.
      const lineCount = randInt(1, 3);
      const lines: Array<{ menu: MenuRow; qty: number; lineTotal: number }> = [];
      for (let j = 0; j < lineCount; j++) {
        const m = pick(menu);
        const qty = randInt(1, 2);
        lines.push({ menu: m, qty, lineTotal: m.price_cents * qty });
      }
      const subtotalCents = lines.reduce((s, l) => s + l.lineTotal, 0);
      const taxCents = Math.round(subtotalCents * taxRate / (100 + taxRate)); // prices include tax
      const totalCents = subtotalCents;
      const paid = Math.random() < 0.7; // 70% pagados, 30% abiertos para que cierre del turno tenga cuentas pendientes que el panel muestre.
      const paymentMethod = paid ? pick(["cash", "card", "transfer"]) : null;
      const paidAt = paid ? new Date(Date.now() - randInt(60, 7200) * 1000) : null;

      const orderResult = (await sql`
        INSERT INTO orders (
          tenant_id, customer_phone, customer_name, table_number, status,
          subtotal_cents, vat_cents, tax_cents, total_cents,
          order_type, kitchen_decision, is_test, shift_id,
          payment_method, paid_at
        ) VALUES (
          ${tenant.id}, ${customerPhone}, ${customerName}, ${tableNumber},
          ${paid ? "paid" : "pending"},
          ${subtotalCents}, ${taxCents}, ${taxCents}, ${totalCents},
          ${orderType}, 'pending', true, ${shiftId},
          ${paymentMethod}, ${paidAt}
        )
        RETURNING id
      `) as Array<{ id: string }>;
      const orderId = orderResult[0]!.id;

      // Order items — schema requiere tenant_id (NOT NULL).
      // NOTA: order_items NO tiene FK menu_item_id — se snapshotea con name+price.
      for (const ln of lines) {
        await sql`
          INSERT INTO order_items (
            order_id, tenant_id, name, quantity, unit_price_cents,
            line_total_cents, vat_rate, tax_rate
          ) VALUES (
            ${orderId}, ${tenant.id}, ${ln.menu.name}, ${ln.qty}, ${ln.menu.price_cents},
            ${ln.lineTotal}, ${taxRate.toString()}, ${taxRate.toString()}
          )
        `;
      }
      okCount++;
    } catch (err) {
      // Log primer error por tenant para debugging.
      if (i === 0) console.error(`  ✗ ${tenant.slug}: ${err instanceof Error ? err.message.slice(0, 120) : err}`);
    }
  }

  // 4) Reservas.
  let apptOk = 0;
  for (let i = 0; i < APPOINTMENTS_PER_TENANT; i++) {
    try {
      const startsAt = new Date(Date.now() + randInt(1, 168) * 60 * 60 * 1000); // próximos 7 días
      await sql`
        INSERT INTO appointments (
          tenant_id, customer_phone, customer_name, starts_at, duration_min,
          title, status, is_test
        ) VALUES (
          ${tenant.id}, ${fakePhone()}, ${pick(FAKE_NAMES)}, ${startsAt}, 90,
          ${`Reserva ${randInt(2, 6)} personas`}, ${pick(["pending", "confirmed"])}, true
        )
      `;
      apptOk++;
    } catch {}
  }

  const elapsed = Date.now() - startedAt;
  if (idx % 20 === 0) {
    console.log(`  [${idx}] ${tenant.slug}: ${okCount}/${ORDERS_PER_TENANT} orders, ${apptOk}/${APPOINTMENTS_PER_TENANT} appts (${elapsed}ms)`);
  }
  return { ok: okCount, fail: ORDERS_PER_TENANT - okCount, appts: apptOk };
}

async function sampleHttpEndToEnd(tenants: TenantRow[]): Promise<void> {
  // Sample 5 tenants random → POST /api/orders con secret runtime → verifica
  // que el path REAL (con createOrder, validación, tax compute, KDS, etc.)
  // funciona bajo la carga ya inserted.
  if (!RUNTIME_INTERNAL_SECRET) {
    console.warn("⚠ Sin RUNTIME_INTERNAL_SECRET — saltando sample HTTP end-to-end");
    return;
  }
  console.log("\n→ Sample HTTP end-to-end (5 tenants random vs prod)...");
  const sample = tenants.sort(() => Math.random() - 0.5).slice(0, 5);
  for (const t of sample) {
    const menu = (await sql`
      SELECT name, price_cents FROM menu_items WHERE tenant_id = ${t.id} LIMIT 1
    `) as Array<{ name: string; price_cents: number }>;
    if (!menu[0]) continue;
    const startTs = Date.now();
    const res = await fetch(`${PROD_BASE}/api/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": RUNTIME_INTERNAL_SECRET },
      body: JSON.stringify({
        tenantSlug: t.slug,
        orderType: "takeaway",
        customerName: "Smoke HTTP Test",
        customerPhone: fakePhone(),
        isTest: true,
        items: [{ name: menu[0].name, quantity: 1, unitPriceCents: menu[0].price_cents }],
      }),
    });
    const elapsed = Date.now() - startTs;
    const body = await res.text();
    const status = res.status === 200 ? "✓" : "✗";
    console.log(`  ${status} ${t.slug} → HTTP ${res.status} (${elapsed}ms) ${body.slice(0, 100)}`);
  }
}

async function main() {
  const t0 = Date.now();
  console.log("→ Cargando tenants mock...");
  const tenants = (await sql`
    SELECT t.id, t.slug, t.tax_rate_standard::text as tax_rate
    FROM tenants t
    WHERE t.slug LIKE 'mock-%'
    ORDER BY t.slug
  `) as TenantRow[];

  console.log(`✓ ${tenants.length} tenants mock encontrados`);
  console.log(`→ Generando ${ORDERS_PER_TENANT} orders + ${APPOINTMENTS_PER_TENANT} appts por tenant...`);

  const BATCH = 10;
  let totalOrders = 0, totalFailed = 0, totalAppts = 0;
  for (let start = 0; start < tenants.length; start += BATCH) {
    const batch = tenants.slice(start, start + BATCH);
    const results = await Promise.allSettled(batch.map((t, i) => loadOneTenant(t, start + i)));
    for (const r of results) {
      if (r.status === "fulfilled") {
        totalOrders += r.value.ok;
        totalFailed += r.value.fail;
        totalAppts += r.value.appts ?? 0;
      } else {
        totalFailed += ORDERS_PER_TENANT;
      }
    }
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n✓ Load done: ${totalOrders} orders, ${totalAppts} appts, ${totalFailed} failed, ${elapsed}s`);

  // Verificación final.
  const stats = (await sql`
    SELECT
      (SELECT count(*)::int FROM orders WHERE is_test = true AND tenant_id IN (SELECT id FROM tenants WHERE slug LIKE 'mock-%')) as orders_test,
      (SELECT count(*)::int FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.is_test = true AND o.tenant_id IN (SELECT id FROM tenants WHERE slug LIKE 'mock-%')) as items_test,
      (SELECT count(*)::int FROM appointments WHERE is_test = true AND tenant_id IN (SELECT id FROM tenants WHERE slug LIKE 'mock-%')) as appts_test,
      (SELECT count(*)::int FROM shifts WHERE tenant_id IN (SELECT id FROM tenants WHERE slug LIKE 'mock-%') AND closed_at IS NULL) as open_shifts,
      (SELECT count(DISTINCT shift_id)::int FROM orders WHERE is_test = true AND tenant_id IN (SELECT id FROM tenants WHERE slug LIKE 'mock-%')) as shifts_used
  `) as Array<{ orders_test: number; items_test: number; appts_test: number; open_shifts: number; shifts_used: number }>;
  console.log("DB final state:", stats[0]);

  // Sample HTTP real para verificar end-to-end.
  await sampleHttpEndToEnd(tenants);
}

main().catch((e) => { console.error(e); process.exit(1); });
