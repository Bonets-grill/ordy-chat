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
    await loginDev(page, SUPER_EMAIL, "/admin", { role: "super_admin" });
    await expect(page.getByRole("heading", { name: /Super Admin/i })).toBeVisible();
    // Nuevo título de sección de Fase 5
    await expect(page.getByRole("heading", { name: /Operaciones/i })).toBeVisible();
    // Links de navegación añadidos
    // Uso exact:true porque el panel tiene DOS links con "Onboarding jobs":
    // uno en sidebar (exacto) y otro en StatLink "Onboarding jobs 24h".
    // El sidebar usa labels: "Onboarding jobs", "Instancias WA",
    // "Feature flags" — ver components/admin-shell.tsx.
    await expect(page.getByRole("link", { name: "Onboarding jobs", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Instancias WA", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Feature flags", exact: true })).toBeVisible();
  });

  test("super admin ve /admin/flags con 3 flag cards", async ({ page }) => {
    await loginDev(page, SUPER_EMAIL, "/admin/flags", { role: "super_admin" });
    await expect(page.getByRole("heading", { name: /Feature flags/i })).toBeVisible();
    // Las 3 keys del sprint. Uso getByRole heading porque el key se pinta
    // dentro de <h3 class="font-mono">; strict mode violation si sólo
    // uso getByText (observado en CI 21-abr: los h3 aparecen duplicados
    // en el render actual).
    await expect(page.getByRole("heading", { name: "onboarding_fast_enabled" }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "validation_mode_default" }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "warmup_enforce" }).first()).toBeVisible();
  });

  test("super admin ve /admin/onboarding-jobs con filtros", async ({ page }) => {
    await loginDev(page, SUPER_EMAIL, "/admin/onboarding-jobs", { role: "super_admin" });
    await expect(page.getByRole("heading", { name: /Onboarding jobs/i })).toBeVisible();
    // Chip 'Todos' debe estar visible
    await expect(page.getByRole("link", { name: /^Todos$/ })).toBeVisible();
  });

  test("super admin ve /admin/instances con tabla", async ({ page }) => {
    await loginDev(page, SUPER_EMAIL, "/admin/instances", { role: "super_admin" });
    await expect(page.getByRole("heading", { name: /Instancias WhatsApp/i })).toBeVisible();
    // Filtros de tier visibles
    await expect(page.getByRole("link", { name: /^fresh$/ })).toBeVisible();
  });
});
