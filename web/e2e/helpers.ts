// e2e/helpers.ts — Utilidades compartidas entre specs.

import { expect, type Page } from "@playwright/test";

export function freshEmail(prefix = "e2e"): string {
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  return `${prefix}-${stamp}@test.ordy.local`;
}

/**
 * Login via dev provider. Requiere ALLOW_DEV_LOGIN=1 en .env.local.
 * Funciona desde cualquier página: navega a /signin, rellena email, envía.
 *
 * IMPORTANTE: el provider `dev` en `lib/auth.ts` SOLO acepta el email que
 * coincide con `SUPER_ADMIN_EMAIL` (restricción de seguridad hasta que
 * Resend esté configurado). Por eso, si `SUPER_ADMIN_EMAIL` está definido,
 * ignoramos el email recibido y usamos ese — de lo contrario cada test
 * fallaba con `CredentialsSignin` en CI. En desarrollo local sin
 * SUPER_ADMIN_EMAIL, respetamos el email original para no cambiar el
 * comportamiento que el dev espera.
 */
export async function loginDev(page: Page, email: string, redirectTo = "/dashboard") {
  const effectiveEmail = process.env.SUPER_ADMIN_EMAIL?.toLowerCase().trim() || email;
  await page.goto(`/signin?from=${encodeURIComponent(redirectTo)}`);
  await expect(page.getByRole("heading", { name: /Entra a Ordy Chat/i })).toBeVisible();

  // El dialog de consentimiento de cookies (GDPR) se pinta sobre el form y
  // sus pointer-events interceptan todos los clicks — setState no se dispara
  // y el form se quedaba en mode=password aunque el test "clickara" el toggle.
  // Dismiss antes de cualquier otra interacción.
  const cookieDialog = page.getByRole("dialog", { name: /Consentimiento de cookies/i });
  if (await cookieDialog.isVisible().catch(() => false)) {
    await page.getByRole("button", { name: /Aceptar todas|Rechazar todas/i }).first().click();
    await expect(cookieDialog).toBeHidden({ timeout: 3_000 });
  }

  // El SignInForm está dentro de un <Suspense> + es Client Component.
  // Hasta que React hydrata los listeners, clicks de Playwright llegan al
  // DOM pero NO disparan setState. Esperamos a que el botón de toggle esté
  // realmente interactivo antes de clickarlo.
  const toggleMagic = page.getByRole("button", { name: /Prefiero enlace mágico/i });
  await expect(toggleMagic).toBeVisible();
  await toggleMagic.click();
  // Verificamos que el mode cambió a magic esperando al subtítulo específico
  // del modo demo (solo aparece con NEXT_PUBLIC_ALLOW_DEV_LOGIN=1). Si esto
  // no aparece en 5s es que el click no hidrató o devMode no está activo.
  await expect(page.getByText(/modo demo sin verificación/i)).toBeVisible({ timeout: 5_000 });

  await page.getByPlaceholder("tu@empresa.com").fill(effectiveEmail);
  await page.getByRole("button", { name: /^Entrar$/i }).click();
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
