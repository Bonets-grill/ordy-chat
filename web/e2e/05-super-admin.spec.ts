import { expect, test } from "@playwright/test";
import { loginDev } from "./helpers";

test.describe("Super admin", () => {
  test("el SUPER_ADMIN_EMAIL accede a /admin y ve panel global", async ({ page }) => {
    // Usamos el email fijo configurado en .env.local → SUPER_ADMIN_EMAIL
    await loginDev(page, "mtmbdeals@gmail.com", "/admin");
    await expect(page.getByRole("heading", { name: "Super Admin" })).toBeVisible();
    await expect(page.getByText(/Tenants totales/i)).toBeVisible();
  });

  test("usuario normal redirige a dashboard al intentar /admin", async ({ page }) => {
    await loginDev(page, `random-${Date.now()}@test.local`, "/admin");
    // middleware redirige a /dashboard o /onboarding (no tiene tenant aún)
    const url = page.url();
    expect(url).toMatch(/\/(dashboard|onboarding)/);
    // En cualquier caso NO está en /admin
    expect(url).not.toContain("/admin");
  });
});
