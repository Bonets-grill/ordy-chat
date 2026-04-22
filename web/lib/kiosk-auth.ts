// web/lib/kiosk-auth.ts
// Auth alternativo para pantallas de cocina always-on. Las rutas KDS
// (`/api/kds/*`) aceptan `x-kiosk-token: <uuid>` como fallback cuando no hay
// session de Auth.js. El token vive en `agent_configs.kiosk_token` (mig 030).
//
// Scope MUY acotado: resolver el tenant a partir del token. Nada más.
// Las rutas que admiten kiosk token son explícitas — NO se debe usar este
// helper en rutas de configuración ni de super admin.

import { eq } from "drizzle-orm";
import { db } from "./db";
import { agentConfigs, tenants } from "./db/schema";
import type { TenantBundle } from "./tenant";
import { requireTenant } from "./tenant";

export const KIOSK_TOKEN_HEADER = "x-kiosk-token";

/** Busca el tenant al que pertenece un kiosk_token. Devuelve null si no existe. */
export async function tenantFromKioskToken(
  token: string | null | undefined,
): Promise<TenantBundle | null> {
  if (!token) return null;
  const clean = token.trim();
  // UUID v4 format — validación barata para evitar hits innecesarios a DB.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clean)) {
    return null;
  }

  const [row] = await db
    .select({ tenant: tenants, config: agentConfigs })
    .from(agentConfigs)
    .innerJoin(tenants, eq(tenants.id, agentConfigs.tenantId))
    .where(eq(agentConfigs.kioskToken, clean))
    .limit(1);

  if (!row) return null;

  const msLeft = row.tenant.trialEndsAt.getTime() - Date.now();
  const trialDaysLeft = Math.max(0, Math.ceil(msLeft / (1000 * 60 * 60 * 24)));

  return { tenant: row.tenant, config: row.config, trialDaysLeft };
}

/**
 * Resuelve el tenant desde la request: primero intenta session (Auth.js),
 * si no hay, intenta kiosk token del header. Devuelve null si ninguna
 * autenticación es válida.
 *
 * USAR SOLO en rutas que explícitamente quieran admitir el kiosco. Para el
 * resto, `requireTenant()` directo.
 */
export async function requireTenantOrKiosk(
  req: Request,
): Promise<TenantBundle | null> {
  const viaSession = await requireTenant();
  if (viaSession) return viaSession;
  const token = req.headers.get(KIOSK_TOKEN_HEADER);
  return tenantFromKioskToken(token);
}
