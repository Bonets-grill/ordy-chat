import { expect, test } from "@playwright/test";
import { freshEmail, loginDev } from "./helpers";

test.describe("Auth (dev login)", () => {
  // loginDev ahora inyecta directamente un JWT session-token válido firmado
  // con AUTH_SECRET, bypassando el flujo signIn() + CSRF + provider authorize
  // (ver comentario extenso en e2e/helpers.ts). Con eso, el test vuelve a
  // ejercitar la landing post-login (/onboarding) sin depender del form.
  test("sign in aterriza en onboarding con sesión válida", async ({ page }) => {
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
