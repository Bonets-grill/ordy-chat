import { expect, test } from "@playwright/test";
import { completarWizard, seedUser, loginDev } from "./helpers";

test.describe("Exportar CSV de conversaciones", () => {
  test("endpoint /api/conversations/export devuelve CSV con header", async ({ page }) => {
    const user = await seedUser("csv");
    await loginDev(page, user.email, "/onboarding?legacy=1", { userId: user.id });
    await completarWizard(page, { businessName: "CSV Negocio", agentName: "Astro" });

    // Reusa las cookies de sesión del contexto del navegador
    const res = await page.request.get("/api/conversations/export");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toMatch(/text\/csv/);
    const body = await res.text();
    expect(body.split("\n")[0]).toBe("telefono,nombre,rol,mensaje,fecha");
  });
});
