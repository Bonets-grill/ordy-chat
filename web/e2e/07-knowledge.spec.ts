import { expect, test } from "@playwright/test";
import { freshEmail, loginDev } from "./helpers";

test.describe("Wizard paso 7 — Knowledge", () => {
  test("entra en modo web, permite conmutar a manual y volver", async ({ page }) => {
    const email = freshEmail("knowledge");
    await loginDev(page, email, "/onboarding");

    // Avanzar hasta el paso 7
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

    // Estamos en el paso 7 — modo web por defecto
    await expect(page.getByRole("heading", { name: /Conecta tu web y lo extraemos todo/i })).toBeVisible();
    await expect(page.getByPlaceholder(/mirestaurante\.com/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Escanear" })).toBeDisabled();

    // Link a manual
    await page.getByRole("button", { name: /Prefiero escribirlo manualmente/i }).click();
    await expect(page.getByPlaceholder(/Copia y pega/i)).toBeVisible();

    // Volver a modo web
    await page.getByRole("button", { name: /Prefieres escanear tu web/i }).click();
    await expect(page.getByPlaceholder(/mirestaurante\.com/i)).toBeVisible();

    // Escanear con URL vacía → botón sigue deshabilitado
    await expect(page.getByRole("button", { name: "Escanear" })).toBeDisabled();

    // Poner una URL habilita el botón
    await page.getByPlaceholder(/mirestaurante\.com/i).fill("https://example.com");
    await expect(page.getByRole("button", { name: "Escanear" })).toBeEnabled();
  });

  test("endpoint /api/scrape rechaza sin sesión", async ({ request }) => {
    const r = await request.post("/api/scrape", {
      data: { url: "https://example.com" },
    });
    expect(r.status()).toBe(401);
  });
});
