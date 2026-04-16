import { expect, test } from "@playwright/test";
import { freshEmail, loginDev } from "./helpers";

test.describe("Auth (dev login)", () => {
  test("sign in redirige a onboarding tras el login", async ({ page }) => {
    const email = freshEmail("auth");
    await loginDev(page, email, "/onboarding");
    await expect(page.getByRole("heading", { name: /Vamos a crear tu agente/i })).toBeVisible();
  });

  test("rutas protegidas redirigen a signin sin sesión", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForURL(/\/signin/);
    await expect(page.getByRole("heading", { name: /Entra a Ordy Chat/i })).toBeVisible();
  });
});
