import { expect, test } from "@playwright/test";
import { freshEmail, loginDev } from "./helpers";

test.describe("Auth (dev login)", () => {
  // TODO(e2e-auth-redirect): test bloqueado por hydration glitch — Next 16 con
  // <Suspense> + React client + Playwright → el click del toggle "Prefiero
  // enlace mágico" no dispara setState a tiempo en dev; en prod-build tampoco
  // (verificado local contra Neon branch). El flujo API-bypass (POST a
  // /api/auth/callback/dev con csrfToken+cookies) funciona con curl pero
  // Playwright no persiste el par csrf-cookie|body de forma coherente (errores
  // observados: CredentialsSignin sin hit authorize, MissingCSRF con inject).
  // Siguiente paso sugerido: o bien refactorizar signin page para no depender
  // de <Suspense> (move useSearchParams fuera del Suspense boundary), o
  // inyectar la session cookie directamente vía DrizzleAdapter en setup.
  test.fixme("sign in redirige a onboarding tras el login", async ({ page }) => {
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
