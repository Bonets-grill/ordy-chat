import { expect, test } from "@playwright/test";
import { acceptCookiesUpfront } from "./helpers";

test.describe("Landing", () => {
  // Pre-inyecta el cookie de consentimiento en cada test de la suite para
  // que el banner nunca se pinte y no intercepte clicks sobre CTAs / chips.
  // Observado en CI headless: el banner aparece con delay y bloquea el click
  // en "Restaurante" (test 3).
  test.beforeEach(async ({ page }) => {
    await acceptCookiesUpfront(page);
  });

  test("hero carga con título, pricing y CTA primario", async ({ page }) => {
    await page.goto("/");
    // H1 actualizado 2026-04-20: "El agente de WhatsApp — que entiende tu restaurante".
    // Matcheamos el trozo estable "que entiende tu restaurante" del gradient span.
    await expect(page.getByRole("heading", { name: /que entiende tu restaurante/i })).toBeVisible();
    await expect(page.getByText(/€19\.90/i).first()).toBeVisible();
    // Botón real en PricingCard: "Empezar los 7 días gratis". Se usa first() porque
    // hay múltiples CTAs en la landing y cualquiera de ellos cumple el contrato.
    await expect(page.getByRole("link", { name: /Empezar/i }).first()).toBeVisible();
  });

  test("navegación interna y páginas legales responden 200", async ({ page }) => {
    // waitUntil "domcontentloaded" evita net::ERR_ABORTED cuando Playwright
    // inicia el siguiente goto() mientras aún hay requests en vuelo del
    // anterior (client JS del cookie-consent, prefetch, analytics).
    // El heading H1 se emite en el HTML inicial, no necesitamos "load".
    await page.goto("/pricing", { waitUntil: "domcontentloaded" });
    // H1 actual: "Un precio base. *Crece con add-ons.*" (post-pivot add-ons
    // 2026-04-20). Matcheamos el trozo estable "Un precio" que aguanta
    // ambos copys (anterior "Un precio. Sin trucos." y actual con add-ons).
    await expect(page.getByRole("heading", { name: /Un precio/i })).toBeVisible();

    await page.goto("/terms", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Términos y condiciones/i })).toBeVisible();

    await page.goto("/privacy", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Política de privacidad/i })).toBeVisible();
  });

  test("chip de nicho autocompleta el textarea del hero", async ({ page }) => {
    await page.goto("/");
    const textarea = page.locator("form textarea").first();
    await expect(textarea).toHaveValue("");

    await page.getByRole("button", { name: "Restaurante" }).click();
    await expect(textarea).toHaveValue(/restaurante/i);
  });
});
