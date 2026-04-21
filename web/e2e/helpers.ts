// e2e/helpers.ts — Utilidades compartidas entre specs.

import { expect, type Page } from "@playwright/test";
import { encode } from "next-auth/jwt";
import { randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";

export function freshEmail(prefix = "e2e"): string {
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  return `${prefix}-${stamp}@test.ordy.local`;
}

type Role = "tenant_admin" | "super_admin";

type LoginOpts = {
  /** Rol efectivo del JWT. Default tenant_admin. */
  role?: Role;
  /** id UUID concreto a meter como sub. Si se omite y role=super_admin, se hace lookup en DB por SUPER_ADMIN_EMAIL. */
  userId?: string;
};

function sqlClient() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL requerido para e2e helpers");
  return neon(url);
}

/**
 * Resuelve el id del super admin desde SUPER_ADMIN_EMAIL. Lo cachea
 * módulo-local para no pegarle a la DB en cada test. Si no existe un
 * row con ese email y role='super_admin', tira un error claro.
 */
let superAdminIdCache: string | null = null;
async function getSuperAdminId(): Promise<string> {
  if (superAdminIdCache) return superAdminIdCache;
  const email = process.env.SUPER_ADMIN_EMAIL?.toLowerCase().trim();
  if (!email) throw new Error("SUPER_ADMIN_EMAIL requerido para loginDev(role='super_admin')");
  const sql = sqlClient();
  const rows = (await sql`
    SELECT id FROM users WHERE lower(email) = ${email} AND role = 'super_admin' LIMIT 1
  `) as { id: string }[];
  if (!rows[0]) {
    throw new Error(
      `No existe users row con email=${email} y role='super_admin'. ` +
        "Ejecuta scripts/create-super-admin o insértalo antes del test.",
    );
  }
  superAdminIdCache = rows[0].id;
  return superAdminIdCache;
}

/**
 * Inserta un usuario fresco en DB (sin tenant). Útil para tests que
 * completan wizard (FK tenant_members → users.id). Retorna el id UUID
 * y el email generado.
 */
export async function seedUser(emailPrefix = "e2e"): Promise<{ id: string; email: string }> {
  const sql = sqlClient();
  const email = freshEmail(emailPrefix);
  const rows = (await sql`
    INSERT INTO users (email, name, role, email_verified)
    VALUES (${email}, 'E2E User', 'tenant_admin', now())
    RETURNING id, email
  `) as { id: string; email: string }[];
  return rows[0];
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
 *   2. Inyectar el JWT como cookie `authjs.session-token`.
 *   3. Navegar al destino — el middleware + auth() leen la cookie y
 *      consideran la sesión válida.
 *
 * Para tests de super_admin: pasar `{ role: "super_admin" }`. El helper
 * hace lookup en DB por SUPER_ADMIN_EMAIL y usa ese id como sub — el
 * callback jwt de auth.ts resuelve el role desde DB.
 *
 * Para tests de wizard/webhook: seedear user primero con `seedUser()` y
 * pasar `{ userId: row.id }` para que la FK tenant_members.user_id
 * apunte a un row existente.
 */
export async function loginDev(
  page: Page,
  _email: string,
  redirectTo = "/dashboard",
  opts: LoginOpts = {},
) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET env requerido para e2e loginDev");
  }

  const role: Role = opts.role ?? "tenant_admin";
  let sub: string;
  if (opts.userId) {
    sub = opts.userId;
  } else if (role === "super_admin") {
    sub = await getSuperAdminId();
  } else {
    // sub random — el callback jwt hace fallback graceful a tenant_admin.
    sub = randomUUID();
  }

  const email =
    role === "super_admin"
      ? process.env.SUPER_ADMIN_EMAIL?.toLowerCase().trim() ?? _email
      : _email;

  const token = await encode({
    token: {
      sub,
      email,
      name: role === "super_admin" ? "E2E Super Admin" : "E2E Test User",
      role,
    },
    secret,
    salt: "authjs.session-token",
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

  await acceptCookiesUpfront(page);
  await page.goto(redirectTo);
  await expect(page).not.toHaveURL(/\/signin/, { timeout: 10_000 });
}

/**
 * Inyecta el cookie de consentimiento ANTES de cualquier navegación, de
 * modo que el banner (components/cookie-consent.tsx) nunca se renderice
 * y no intercepte clicks sobre elementos en la parte inferior del
 * viewport (CTAs, Siguiente del wizard, botones de chip en el hero).
 *
 * Nombre exacto: ordy_consent_v1 (ver lib/reseller/consent.ts).
 */
export async function acceptCookiesUpfront(page: Page): Promise<void> {
  // Playwright.addCookies acepta `url` XOR `domain+path`, nunca ambos.
  // Pasar ambos en CI (Playwright 1.x) revienta con:
  //   "Cookie should have either url or path"
  // El form `url` ya implica path=/ para el host/puerto dado.
  await page.context().addCookies([
    {
      name: "ordy_consent_v1",
      value: "accepted",
      url: "http://localhost:3000",
      sameSite: "Lax",
    },
  ]);
}

/**
 * Cierra el banner de consentimiento si ya está montado (rescue path).
 * El camino preferido es acceptCookiesUpfront, que previene que aparezca.
 */
export async function dismissCookieBanner(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog", { name: /Consentimiento de cookies/i });
  if (await dialog.isVisible().catch(() => false)) {
    const accept = dialog.getByRole("button", { name: /Aceptar/i }).first();
    if (await accept.isVisible().catch(() => false)) {
      await accept.click();
      await expect(dialog).toBeHidden({ timeout: 5_000 });
    }
  }
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

  // Helper: espera a que Siguiente esté habilitado y hace click. El wizard
  // deshabilita el botón hasta que el paso valida (canNext). React 19 con
  // concurrent rendering puede diferir la actualización de estado tras
  // fill(); sin waiter explícito el click llega antes de que el botón
  // quede habilitado y Playwright reintenta hasta timeout.
  const clickSiguiente = async () => {
    const btn = page.getByRole("button", { name: "Siguiente", exact: true });
    await expect(btn).toBeEnabled({ timeout: 10_000 });
    await btn.click();
  };

  // Paso 1 — nombre del negocio
  await page.getByPlaceholder("Nombre del negocio").fill(opts.businessName);
  await clickSiguiente();

  // Paso 2 — descripción (min 10 chars)
  await page.getByPlaceholder(/Qué vendes/i).fill(
    `${opts.businessName} — negocio de prueba para tests automatizados. Vendemos servicios genéricos de alta calidad a clientes B2B.`,
  );
  await clickSiguiente();

  // Paso 3 — casos de uso
  await page.getByRole("button", { name: "Responder preguntas frecuentes" }).click();
  await page.getByRole("button", { name: "Agendar citas o reservaciones" }).click();
  await clickSiguiente();

  // Paso 4 — nombre del agente
  await page.getByPlaceholder("Nombre del agente").fill(opts.agentName);
  await clickSiguiente();

  // Paso 5 — tono (Amigable ya viene por defecto, pero lo forzamos explícito)
  await page.getByRole("button", { name: "Amigable", exact: false }).first().click();
  await clickSiguiente();

  // Paso 6 — horario (min 3 chars)
  await page.getByPlaceholder(/Lunes a Viernes/i).fill("L-V 10:00-20:00");
  await clickSiguiente();

  // Paso 7 — knowledge (opcional, dejamos vacío)
  await clickSiguiente();

  // Paso 8 — proveedor (Whapi por defecto)
  await page.getByRole("button", { name: /Whapi.cloud/i }).click();
  await clickSiguiente();

  // Paso 9 — credenciales Whapi
  await page.getByPlaceholder("eyJ...").fill("fake-whapi-token-for-e2e");
  await page.getByRole("button", { name: /Crear agente/i }).click();

  await page.waitForURL("**/dashboard", { timeout: 20_000 });
}
