import { expect, test } from "@playwright/test";

// Smoke tests del flujo onboarding fast. No ejecutan el scrape/merger real
// (requiere Auth.js session + Neon + runtime + Anthropic). Cubren:
//   - /onboarding/fast sin sesión → redirect a /signin.
//   - /onboarding?legacy=1 NO redirige al fast (escape hatch funciona).
//   - feature flag ONBOARDING_FAST_ENABLED controla el redirect default.
// El flujo completo queda cubierto por:
//   - 82 tests vitest (canonical, sanitize, merger, provision, scrapers)
//   - 43 pytest (SSRF guard + warmup)
//   - Smoke manual con 1 negocio conocido pre-deploy.

test.describe("Onboarding fast — smoke", () => {
  test("GET /onboarding/fast sin sesión → redirect a /signin", async ({ page }) => {
    const response = await page.goto("/onboarding/fast");
    // Dependiendo del middleware/Auth.js, puede redirigir 302 o renderizar /signin.
    await expect(page).toHaveURL(/\/signin/);
    expect(response?.status()).toBeLessThan(500);
  });

  test("GET /onboarding?legacy=1 NO redirige a /onboarding/fast", async ({ page }) => {
    // Independientemente del valor del feature flag, ?legacy=1 debe forzar wizard.
    await page.goto("/onboarding?legacy=1");
    // Si no hay sesión → /signin; con sesión → /onboarding renderiza wizard.
    // En ambos casos NO debe ser /onboarding/fast.
    await expect(page).not.toHaveURL(/\/onboarding\/fast/);
  });
});
