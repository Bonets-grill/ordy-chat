// e2e/helpers.ts — Utilidades compartidas entre specs.

import { expect, type Page } from "@playwright/test";
import { encode } from "next-auth/jwt";
import { randomUUID } from "node:crypto";

export function freshEmail(prefix = "e2e"): string {
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  return `${prefix}-${stamp}@test.ordy.local`;
}

/**
 * Inyecta una sesión válida de next-auth directamente vía cookie, sin
 * pasar por el flow de signIn(). Bypass definitivo del bug e2e 02-auth:
 * el provider `dev` con CSRF double-submit validation en next-auth v5
 * beta 25 rechaza los POST desde Playwright aunque con curl funcionan.
 *
 * Flujo:
 *   1. Generar un JWT firmado con AUTH_SECRET usando `encode` de
 *      next-auth/jwt (la misma función que next-auth usa internamente).
 *   2. Inyectar el JWT como cookie `authjs.session-token` en el context
 *      del browser.
 *   3. Navegar al destino — el middleware + auth() leen la cookie y
 *      consideran la sesión válida.
 *
 * El sub/userId del token no necesita existir en la tabla `users`: el
 * callback `jwt` de auth.ts hace un `db.select` del role por userId y,
 * si no encuentra, default a "tenant_admin" — acceso OK a /onboarding,
 * /dashboard, /agent, /billing. Para tests que requieren super_admin,
 * pasar `role: "super_admin"` y el id de un super admin real en DB.
 */
export async function loginDev(page: Page, _email: string, redirectTo = "/dashboard") {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET env requerido para e2e loginDev");
  }
  // _email es histórico — el helper ignora el argumento. Aceptado como
  // identificador vía SUPER_ADMIN_EMAIL para futuro. El JWT lleva un sub
  // UUID válido (ej. randomUUID) — Postgres rechaza UUIDs no-canónicos
  // en queries JOIN sobre users.id, así que cualquier prefijo como "e2e-"
  // tira 500. El UUID random no existe en DB, lo cual está bien: los
  // callbacks jwt y session hacen db.select graceful con fallback, y
  // requireTenant() devuelve null → onboarding lo deja pasar.
  const email = process.env.SUPER_ADMIN_EMAIL?.toLowerCase().trim() || _email;
  const token = await encode({
    token: {
      sub: randomUUID(),
      email,
      name: "E2E Test User",
      role: "tenant_admin",
    },
    secret,
    salt: "authjs.session-token",
    // 1h — suficiente para cualquier e2e.
    maxAge: 60 * 60,
  });

  await page.context().addCookies([
    {
      name: "authjs.session-token",
      value: token,
      url: "http://localhost:3000",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);

  await page.goto(redirectTo);
  await expect(page).not.toHaveURL(/\/signin/, { timeout: 10_000 });
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
