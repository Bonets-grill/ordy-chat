import { expect, test } from "@playwright/test";
import { freshEmail, loginDev } from "./helpers";

test.describe("Wizard paso 7 — Knowledge", () => {
  test("muestra las dos opciones (web / manual) y permite volver", async ({ page }) => {
    const email = freshEmail("knowledge");
    await loginDev(page, email, "/onboarding");

    // Avanzar hasta el paso 7 rápidamente
    await page.getByPlaceholder("Nombre del negocio").fill("Knowledge Test");
    await page.getByRole("button", { name: /Siguiente/i }).click();
    await page.getByPlaceholder(/Qué vendes/i).fill("Descripción de prueba para llegar al paso 7.");
    await page.getByRole("button", { name: /Siguiente/i }).click();
    await page.getByRole("button", { name: "Responder preguntas frecuentes" }).click();
    await page.getByRole("button", { name: /Siguiente/i }).click();
    await page.getByPlaceholder("Nombre del agente").fill("KB");
    await page.getByRole("button", { name: /Siguiente/i }).click();
    await page.getByRole("button", { name: /Siguiente/i }).click();
    await page.getByRole("button", { name: /Siguiente/i }).click();

    await expect(page.getByText(/¿De dónde sacamos la información/i)).toBeVisible();
    await expect(page.getByText("Desde mi web")).toBeVisible();
    await expect(page.getByText("Pegarlo manualmente")).toBeVisible();

    // Modo manual → textarea visible
    await page.getByText("Pegarlo manualmente").click();
    await expect(page.getByPlaceholder(/Copia y pega/i)).toBeVisible();

    // Link inline para volver a la selección
    await page.getByRole("button", { name: /Prefieres escanear tu web/i }).click();
    await expect(page.getByText("Desde mi web")).toBeVisible();

    // Modo web → input URL visible
    await page.getByText("Desde mi web").click();
    await expect(page.getByPlaceholder(/minegocio\.com/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Escanear" })).toBeDisabled();
  });

  test("endpoint /api/scrape rechaza sin sesión", async ({ request }) => {
    const r = await request.post("/api/scrape", {
      data: { url: "https://example.com" },
    });
    expect(r.status()).toBe(401);
  });
});
