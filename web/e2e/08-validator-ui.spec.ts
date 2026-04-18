import { expect, test } from "@playwright/test";
import { loginDev } from "./helpers";

// Sprint 3 validador-ui · Fase 11 E2E smoke.
// Requiere ALLOW_DEV_LOGIN=1 + SUPER_ADMIN_EMAIL en CI.
// Solo comprueba gating auth + renderizado base (no crea runs reales).

const SUPER_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? "e2e-admin@ci.ordychat.local";

test.describe("Validador UI", () => {
  test("sin sesión → /admin/validator redirige a /signin", async ({ page }) => {
    const r = await page.goto("/admin/validator");
    await expect(page).toHaveURL(/\/signin/);
    expect(r?.status()).toBeLessThan(500);
  });

  test("sin sesión → /admin/validator/<run_id> redirige a /signin", async ({ page }) => {
    await page.goto("/admin/validator/00000000-0000-0000-0000-000000000000");
    await expect(page).toHaveURL(/\/signin/);
  });

  test("sin sesión → /admin/tenants/<id> redirige a /signin", async ({ page }) => {
    await page.goto("/admin/tenants/00000000-0000-0000-0000-000000000000");
    await expect(page).toHaveURL(/\/signin/);
  });

  test("super admin ve /admin/validator con KPIs y filtros", async ({ page }) => {
    await loginDev(page, SUPER_EMAIL, "/admin/validator");
    await expect(page.getByRole("heading", { name: /Validador/i })).toBeVisible();
    await expect(page.getByLabel(/Estado/i)).toBeVisible();
    await expect(page.getByLabel(/Ventana/i)).toBeVisible();
    await expect(page.getByLabel(/Tenant/i)).toBeVisible();
  });

  test("super admin ve KPIs validator en /admin home", async ({ page }) => {
    await loginDev(page, SUPER_EMAIL, "/admin");
    await expect(page.getByText(/Validator runs 24h/i)).toBeVisible();
    await expect(page.getByText(/Validator fail 24h/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /^Validador$/ })).toBeVisible();
  });

  test("/admin/validator/<uuid-no-existe> muestra 404 o redirige a signin (no 500)", async ({ page }) => {
    await loginDev(page, SUPER_EMAIL, "/admin");
    const r = await page.goto("/admin/validator/00000000-0000-0000-0000-000000000000");
    expect(r?.status()).toBeLessThan(500);
  });
});
