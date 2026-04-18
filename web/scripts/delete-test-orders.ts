// web/scripts/delete-test-orders.ts — Borra pedidos de tenants de prueba.
//
// Ejecución:
//   pnpm tsx --env-file=.env.local scripts/delete-test-orders.ts          # dry-run (preview)
//   pnpm tsx --env-file=.env.local scripts/delete-test-orders.ts --yes    # confirmado
//
// Tenants considerados "prueba": slugs que empiezan por e2e-, cafeteria-e2e-,
// webhook-negocio-, pausa-negocio-, csv-negocio-. NO toca datos del tenant
// bonets-grill-icod ni otros de producción.

import { count, eq, inArray, like, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, receipts, tenants } from "@/lib/db/schema";

async function main() {
  const isConfirmed = process.argv.includes("--yes");
  console.log(isConfirmed ? "🚨 MODO CONFIRMADO — se borrarán datos" : "👀 DRY-RUN — no borra nada");
  console.log("");

  const testTenants = await db
    .select({ id: tenants.id, slug: tenants.slug, name: tenants.name })
    .from(tenants)
    .where(
      or(
        like(tenants.slug, "e2e-%"),
        like(tenants.slug, "cafeteria-e2e-%"),
        like(tenants.slug, "webhook-negocio-%"),
        like(tenants.slug, "pausa-negocio-%"),
        like(tenants.slug, "csv-negocio-%"),
      ),
    );

  console.log(`Tenants de prueba encontrados: ${testTenants.length}`);
  for (const t of testTenants.slice(0, 20)) console.log(`  · ${t.slug} (${t.name})`);
  if (testTenants.length > 20) console.log(`  … (${testTenants.length - 20} más)`);
  console.log("");

  if (testTenants.length === 0) {
    console.log("Nada que borrar. Exiting.");
    process.exit(0);
  }

  const ids = testTenants.map((t) => t.id);

  // Preview: cuántos orders + receipts van a caer en cascada.
  const [ordersStat] = await db.select({ n: count() }).from(orders).where(inArray(orders.tenantId, ids));
  const [receiptsStat] = await db.select({ n: count() }).from(receipts).where(inArray(receipts.tenantId, ids));

  console.log(`Orders a borrar: ${ordersStat?.n ?? 0}`);
  console.log(`Receipts a borrar (cascade): ${receiptsStat?.n ?? 0}`);
  console.log("");

  if (!isConfirmed) {
    console.log("Re-ejecuta con --yes para borrar.");
    process.exit(0);
  }

  // Borrado efectivo. `orders → order_items CASCADE → receipts CASCADE`.
  const deleted = await db.delete(orders).where(inArray(orders.tenantId, ids)).returning({ id: orders.id });
  console.log(`✓ Borrados ${deleted.length} orders.`);
  console.log("(order_items y receipts eliminados en cascada)");

  // NOTA: no borramos los tenants — los dejamos por si hay conversaciones/FAQs útiles.
  // Si quieres limpiarlos, hazlo manualmente tras confirmar.
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
