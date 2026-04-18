import { expect, test } from "@playwright/test";
import { loginDev } from "./helpers";

// Smoke tests Sprint 1 super-admin-v2.
// Requiere: ALLOW_DEV_LOGIN=1 + SUPER_ADMIN_EMAIL en env del CI.
// El user con email === SUPER_ADMIN_EMAIL obtiene role='super_admin'
// automáticamente al primer registro (CLAUDE.md del repo).

const SUPER_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? "e2e-admin@ci.ordychat.local";

test.describe("Super admin v2", () => {
  test("sin sesión → /admin/flags redirige a /signin", async ({ page }) => {
    const r = await page.goto("/admin/flags");
    await expect(page).toHaveURL(/\/signin/);
    expect(r?.status()).toBeLessThan(500);
  });

  test("sin sesión → /admin/onboarding-jobs redirige a /signin", async ({ page }) => {
    await page.goto("/admin/onboarding-jobs");
    await expect(page).toHaveURL(/\/signin/);
  });

  test("sin sesión → /admin/instances redirige a /signin", async ({ page }) => {
    await page.goto("/admin/instances");
    await expect(page).toHaveURL(/\/signin/);
  });

  test("super admin ve /admin con las KPI cards nuevas", async ({ page }) => {
    await loginDev(page, SUPER_EMAIL, "/admin");
    await expect(page.getByRole("heading", { name: /Super Admin/i })).toBeVisible();
    // Nuevo título de sección de Fase 5
    await expect(page.getByRole("heading", { name: /Operaciones/i })).toBeVisible();
    // Links de navegación añadidos
    await expect(page.getByRole("link", { name: /Onboarding jobs/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /Instancias/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /Feature flags/i })).toBeVisible();
  });

  test("super admin ve /admin/flags con 3 flag cards", async ({ page }) => {
    await loginDev(page, SUPER_EMAIL, "/admin/flags");
    await expect(page.getByRole("heading", { name: /Feature flags/i })).toBeVisible();
    // Las 3 keys del sprint
    await expect(page.getByText("onboarding_fast_enabled")).toBeVisible();
    await expect(page.getByText("validation_mode_default")).toBeVisible();
    await expect(page.getByText("warmup_enforce")).toBeVisible();
  });

  test("super admin ve /admin/onboarding-jobs con filtros", async ({ page }) => {
    await loginDev(page, SUPER_EMAIL, "/admin/onboarding-jobs");
    await expect(page.getByRole("heading", { name: /Onboarding jobs/i })).toBeVisible();
    // Chip 'Todos' debe estar visible
    await expect(page.getByRole("link", { name: /^Todos$/ })).toBeVisible();
  });

  test("super admin ve /admin/instances con tabla", async ({ page }) => {
    await loginDev(page, SUPER_EMAIL, "/admin/instances");
    await expect(page.getByRole("heading", { name: /Instancias WhatsApp/i })).toBeVisible();
    // Filtros de tier visibles
    await expect(page.getByRole("link", { name: /^fresh$/ })).toBeVisible();
  });
});
