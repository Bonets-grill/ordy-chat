import { expect, test } from "@playwright/test";
import { completarWizard, seedUser, loginDev } from "./helpers";

test.describe("Panel del agente", () => {
  test("URL del webhook incluye el token ?s= y apunta al runtime", async ({ page }) => {
    const user = await seedUser("webhook");
    await loginDev(page, user.email, "/onboarding?legacy=1", { userId: user.id });
    await completarWizard(page, { businessName: "Webhook Negocio", agentName: "Bot" });

    await page.goto("/agent");
    await expect(page.getByRole("heading", { name: "Mi agente" })).toBeVisible();

    // Código con la URL — debe contener /webhook/whapi/<slug>?s=<token>
    const code = page.locator("code").first();
    const url = await code.innerText();
    expect(url).toMatch(/\/webhook\/whapi\/webhook-negocio/);
    expect(url).toMatch(/\?s=[A-Za-z0-9_-]{10,}/);
  });

  test("pausa y reactiva el agente sin navegar", async ({ page }) => {
    const user = await seedUser("pause");
    await loginDev(page, user.email, "/onboarding?legacy=1", { userId: user.id });
    await completarWizard(page, { businessName: "Pausa Negocio", agentName: "Luna" });

    await page.goto("/agent");
    const pauseBtn = page.getByRole("button", { name: "Pausar" });
    await expect(pauseBtn).toBeVisible();
    await pauseBtn.click();
    await expect(page.getByRole("button", { name: "Reactivar" })).toBeVisible();
  });
});
