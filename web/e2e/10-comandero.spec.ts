// e2e/10-comandero.spec.ts — Happy path del comandero (mesero humano).
// Flujo: tomar pedido en mesa → enviar a cocina → cobrar y cerrar mesa.
//
// Requiere DATABASE_URL + AUTH_SECRET en env (lo carga playwright.config.ts).
// Seedea tenant + menu_item + restaurant_table directo via SQL para no
// depender del wizard ni de Anthropic en el path.

import { expect, test } from "@playwright/test";
import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";
import { freshEmail, loginDev } from "./helpers";

function sqlClient() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL requerido");
  return neon(url);
}

async function seedComanderoFixture() {
  const sql = sqlClient();
  const email = freshEmail("comandero");
  const slug = `e2e-comandero-${Date.now().toString(36)}`;

  const userRows = (await sql`
    INSERT INTO users (email, name, role, email_verified)
    VALUES (${email}, 'E2E Comandero', 'tenant_admin', now())
    RETURNING id, email
  `) as { id: string; email: string }[];
  const user = userRows[0];

  const tenantRows = (await sql`
    INSERT INTO tenants (slug, name, owner_user_id, subscription_status, trial_ends_at)
    VALUES (${slug}, 'E2E Comandero Resto', ${user.id}, 'trialing', now() + interval '14 days')
    RETURNING id
  `) as { id: string }[];
  const tenantId = tenantRows[0].id;

  await sql`
    INSERT INTO tenant_members (user_id, tenant_id, role)
    VALUES (${user.id}, ${tenantId}, 'owner')
  `;

  await sql`
    INSERT INTO agent_configs (tenant_id, system_prompt, agent_name)
    VALUES (${tenantId}, 'Test prompt', 'TestBot')
  `;

  const itemId = randomUUID();
  await sql`
    INSERT INTO menu_items (id, tenant_id, category, name, price_cents, available)
    VALUES (${itemId}, ${tenantId}, 'Bebidas', 'Coca-Cola E2E', 250, true)
  `;

  await sql`
    INSERT INTO restaurant_tables (tenant_id, number, seats, active)
    VALUES (${tenantId}, 'E1', 4, true)
  `;

  return { user, slug, tenantId, itemId };
}

async function cleanupComanderoFixture(slug: string) {
  const sql = sqlClient();
  await sql`DELETE FROM tenants WHERE slug = ${slug}`;
}

test.describe("Comandero — happy path", () => {
  test("toma un pedido y cierra la mesa", async ({ page }) => {
    const fx = await seedComanderoFixture();
    try {
      await loginDev(page, fx.user.email, "/agent/comandero", { userId: fx.user.id });

      // Pantalla 1: grid de mesas. Mesa E1 visible y libre.
      await expect(page.getByRole("heading", { name: /Comandero/i })).toBeVisible();
      const tableCard = page.locator("button", { hasText: "E1" }).first();
      await expect(tableCard).toBeVisible({ timeout: 10_000 });
      await expect(tableCard).toContainText("Libre");

      // Tap mesa → vista carta.
      await tableCard.click();
      await expect(page.getByRole("heading", { name: /Mesa E1/i })).toBeVisible();

      // Esperar a que cargue la carta y aparezca el item seedeado.
      const itemRow = page.locator("li", { hasText: "Coca-Cola E2E" }).first();
      await expect(itemRow).toBeVisible({ timeout: 10_000 });

      // Click + para añadir al carrito.
      await itemRow.getByRole("button", { name: /Añadir Coca-Cola/i }).click();

      // Carrito flotante visible con total.
      const submitBtn = page.getByRole("button", { name: /Enviar a cocina/i });
      await expect(submitBtn).toBeVisible();
      await expect(submitBtn).toContainText("2,50");

      // Enviar a cocina.
      await submitBtn.click();

      // Vuelve al grid → mesa E1 ahora ocupada con botones cobrar.
      await expect(page.getByRole("heading", { name: /Comandero/i })).toBeVisible({ timeout: 10_000 });
      const tableCard2 = page.locator("button", { hasText: "E1" }).first();
      await expect(tableCard2).toContainText(/Ocupada/i);

      // Cerrar mesa (efectivo). Confirm dialog auto-acceptado.
      page.once("dialog", (d) => d.accept());
      await page.getByRole("button", { name: /Efectivo/i }).first().click();

      // Tras cerrar, mesa vuelve a libre.
      await expect(page.locator("button", { hasText: "E1" }).first()).toContainText(/Libre/i, {
        timeout: 10_000,
      });
    } finally {
      await cleanupComanderoFixture(fx.slug);
    }
  });
});
