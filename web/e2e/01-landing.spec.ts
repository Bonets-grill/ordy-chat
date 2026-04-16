import { expect, test } from "@playwright/test";

test.describe("Landing", () => {
  test("hero carga con título, pricing y CTA primario", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /que de verdad vende/i })).toBeVisible();
    await expect(page.getByText(/€19.90\/mes/i).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Empezar gratis/i }).first()).toBeVisible();
  });

  test("navegación interna y páginas legales responden 200", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page.getByRole("heading", { name: /Un precio\. Sin trucos\./i })).toBeVisible();

    await page.goto("/terms");
    await expect(page.getByRole("heading", { name: /Términos y condiciones/i })).toBeVisible();

    await page.goto("/privacy");
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
