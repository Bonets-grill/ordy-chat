// e2e/helpers.ts — Utilidades compartidas entre specs.

import { expect, type Page } from "@playwright/test";

export function freshEmail(prefix = "e2e"): string {
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  return `${prefix}-${stamp}@test.ordy.local`;
}

/**
 * Login via dev provider. Requiere ALLOW_DEV_LOGIN=1 en .env.local.
 * Funciona desde cualquier página: navega a /signin, rellena email, envía.
 */
export async function loginDev(page: Page, email: string, redirectTo = "/dashboard") {
  await page.goto(`/signin?from=${encodeURIComponent(redirectTo)}`);
  await expect(page.getByRole("heading", { name: /Entra a Ordy Chat/i })).toBeVisible();
  await page.getByPlaceholder("tu@empresa.com").fill(email);
  await page.getByRole("button", { name: /Enviar enlace/i }).click();
  // El dev provider redirige inmediatamente al callbackUrl sin email real.
  await page.waitForURL((url) => !url.pathname.startsWith("/signin"), { timeout: 15_000 });
}

/**
 * Completa el wizard de 9 pasos con datos predecibles.
 * Deja al usuario en /dashboard.
 */
export async function completarWizard(
  page: Page,
  opts: { businessName: string; agentName: string },
) {
  await expect(page.getByRole("heading", { name: /Vamos a crear tu agente/i })).toBeVisible();

  // Paso 1 — nombre del negocio
  await page.getByPlaceholder("Nombre del negocio").fill(opts.businessName);
  await page.getByRole("button", { name: /Siguiente/i }).click();

  // Paso 2 — descripción
  await page.getByPlaceholder(/Qué vendes/i).fill(
    `${opts.businessName} — negocio de prueba para tests automatizados. Vendemos servicios genéricos de alta calidad a clientes B2B.`,
  );
  await page.getByRole("button", { name: /Siguiente/i }).click();

  // Paso 3 — casos de uso
  await page.getByRole("button", { name: "Responder preguntas frecuentes" }).click();
  await page.getByRole("button", { name: "Agendar citas o reservaciones" }).click();
  await page.getByRole("button", { name: /Siguiente/i }).click();

  // Paso 4 — nombre del agente
  await page.getByPlaceholder("Nombre del agente").fill(opts.agentName);
  await page.getByRole("button", { name: /Siguiente/i }).click();

  // Paso 5 — tono (Amigable ya viene por defecto)
  await page.getByRole("button", { name: "Amigable", exact: false }).first().click();
  await page.getByRole("button", { name: /Siguiente/i }).click();

  // Paso 6 — horario
  await page.getByRole("button", { name: /Siguiente/i }).click();

  // Paso 7 — knowledge (opcional, dejamos vacío)
  await page.getByRole("button", { name: /Siguiente/i }).click();

  // Paso 8 — proveedor (Whapi por defecto)
  await page.getByRole("button", { name: /Whapi.cloud/i }).click();
  await page.getByRole("button", { name: /Siguiente/i }).click();

  // Paso 9 — credenciales Whapi
  await page.getByPlaceholder("eyJ...").fill("fake-whapi-token-for-e2e");
  await page.getByRole("button", { name: /Crear agente/i }).click();

  await page.waitForURL("**/dashboard", { timeout: 20_000 });
}
