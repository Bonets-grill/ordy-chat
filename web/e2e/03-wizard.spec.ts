import { expect, test } from "@playwright/test";
import { completarWizard, freshEmail, loginDev } from "./helpers";

test.describe("Onboarding wizard", () => {
  test("crea tenant end-to-end y aterriza en el dashboard", async ({ page }) => {
    const email = freshEmail("wizard");
    await loginDev(page, email, "/onboarding");
    await completarWizard(page, { businessName: "Cafetería E2E", agentName: "Sofía" });

    // Dashboard del tenant recién creado
    await expect(page.getByRole("heading", { name: /Hola, Cafetería E2E/i })).toBeVisible();
    await expect(page.getByText(/Conversaciones/).first()).toBeVisible();
  });

  test("bloquea el botón Siguiente si el paso está incompleto", async ({ page }) => {
    const email = freshEmail("wizard-block");
    await loginDev(page, email, "/onboarding");

    const next = page.getByRole("button", { name: /Siguiente/i });
    await expect(next).toBeDisabled();

    await page.getByPlaceholder("Nombre del negocio").fill("X"); // 1 char, min 2
    await expect(next).toBeDisabled();

    await page.getByPlaceholder("Nombre del negocio").fill("Acme");
    await expect(next).toBeEnabled();
  });
});
