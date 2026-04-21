import { expect, test } from "@playwright/test";
import { seedUser, loginDev, typeInto } from "./helpers";

test.describe("Wizard paso 7 — Knowledge", () => {
  test("entra en modo web, permite conmutar a manual y volver", async ({ page }) => {
    const user = await seedUser("knowledge");
    await loginDev(page, user.email, "/onboarding?legacy=1", { userId: user.id });

    // Helper local: espera Siguiente habilitado + click. Evita races en
    // React 19 concurrent rendering donde fill() difiere el re-render.
    const next = async () => {
      const btn = page.getByRole("button", { name: "Siguiente", exact: true });
      await expect(btn).toBeEnabled({ timeout: 10_000 });
      await btn.click();
    };

    // Avanzar hasta el paso 7
    await typeInto(page.getByPlaceholder("Nombre del negocio"), "Knowledge Test");
    await next();
    await typeInto(page.getByPlaceholder(/Qué vendes/i), "Descripción de prueba para llegar al paso 7.");
    await next();
    await page.getByRole("button", { name: "Responder preguntas frecuentes" }).click();
    await next();
    await typeInto(page.getByPlaceholder("Nombre del agente"), "KB");
    await next();
    // Paso 5 — tono (seleccionar Amigable explícito)
    await page.getByRole("button", { name: "Amigable", exact: false }).first().click();
    await next();
    // Paso 6 — horario (min 3 chars)
    await typeInto(page.getByPlaceholder(/Lunes a Viernes/i), "L-V 10-18");
    await next();

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
    await typeInto(page.getByPlaceholder(/mirestaurante\.com/i), "https://example.com");
    await expect(page.getByRole("button", { name: "Escanear" })).toBeEnabled();
  });

  test("endpoint /api/scrape rechaza sin sesión", async ({ request }) => {
    const r = await request.post("/api/scrape", {
      data: { url: "https://example.com" },
    });
    expect(r.status()).toBe(401);
  });
});
