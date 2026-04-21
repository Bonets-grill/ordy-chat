import { expect, test } from "@playwright/test";
import { completarWizard, seedUser, loginDev } from "./helpers";

test.describe("Onboarding wizard", () => {
  test("crea tenant end-to-end y aterriza en el dashboard", async ({ page }) => {
    const user = await seedUser("wizard");
    await loginDev(page, user.email, "/onboarding?legacy=1", { userId: user.id });
    await completarWizard(page, { businessName: "Cafetería E2E", agentName: "Sofía" });

    // Dashboard del tenant recién creado
    await expect(page.getByRole("heading", { name: /Hola, Cafetería E2E/i })).toBeVisible();
    await expect(page.getByText(/Conversaciones/).first()).toBeVisible();
  });

  test("bloquea el botón Siguiente si el paso está incompleto", async ({ page }) => {
    const user = await seedUser("wizard-block");
    await loginDev(page, user.email, "/onboarding?legacy=1", { userId: user.id });

    const next = page.getByRole("button", { name: /Siguiente/i });
    await expect(next).toBeDisabled();

    await page.getByPlaceholder("Nombre del negocio").fill("X"); // 1 char, min 2
    await expect(next).toBeDisabled();

    await page.getByPlaceholder("Nombre del negocio").fill("Acme");
    await expect(next).toBeEnabled();
  });
});
