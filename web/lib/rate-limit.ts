// web/lib/rate-limit.ts — Rate limiting con Upstash Redis.
//
// Si UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN están configurados,
// aplica rate limit. Si no, es no-op (permitir todo). Esto evita romper dev
// local y el primer deploy sin Upstash configurado.
//
// Dos presets:
//   - global(ip):  100 req/min por IP sobre /api/*
//   - perTenant(tenant_id): 1000 req/min por tenant (anti-abuse dashboard)
//   - whatsapp(phone): 1 msg/seg por teléfono origen (anti-ban WhatsApp)

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

let _redis: Redis | null = null;

function getRedis(): Redis | null {
  if (_redis) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  _redis = new Redis({ url, token });
  return _redis;
}

const _cache: Record<string, Ratelimit> = {};

function limiter(name: string, limit: number, window: Parameters<typeof Ratelimit.slidingWindow>[1]): Ratelimit | null {
  if (_cache[name]) return _cache[name];
  const redis = getRedis();
  if (!redis) return null;
  _cache[name] = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(limit, window),
    prefix: `ordy:rl:${name}`,
    analytics: false,
  });
  return _cache[name];
}

export async function limitByIp(ip: string): Promise<{ ok: true } | { ok: false; reset: number }> {
  const rl = limiter("ip", 100, "1 m");
  if (!rl) return { ok: true };
  const r = await rl.limit(ip);
  return r.success ? { ok: true } : { ok: false, reset: r.reset };
}

export async function limitByTenant(tenantId: string): Promise<{ ok: true } | { ok: false; reset: number }> {
  const rl = limiter("tenant", 1000, "1 m");
  if (!rl) return { ok: true };
  const r = await rl.limit(tenantId);
  return r.success ? { ok: true } : { ok: false, reset: r.reset };
}

export async function limitByWhatsappSender(phone: string): Promise<{ ok: true } | { ok: false; reset: number }> {
  // Anti-ban WhatsApp: 1 msg/seg por número origen. Upstash atómico.
  const rl = limiter("wa", 1, "1 s");
  if (!rl) return { ok: true };
  const r = await rl.limit(phone);
  return r.success ? { ok: true } : { ok: false, reset: r.reset };
}

export async function limitByUserOnboarding(userId: string): Promise<{ ok: true } | { ok: false; reset: number }> {
  // Onboarding fast: 5 jobs/hora/user. Evita abuso (scrapes en cadena,
  // llamadas N veces a Anthropic merger).
  const rl = limiter("onboarding", 5, "1 h");
  if (!rl) return { ok: true };
  const r = await rl.limit(userId);
  return r.success ? { ok: true } : { ok: false, reset: r.reset };
}

export async function limitByTenantValidatorManual(
  tenantId: string,
): Promise<{ ok: true } | { ok: false; reset: number }> {
  // Sprint 3 validador-ui F5: 3 runs manuales por hora por tenant.
  // Defensa en profundidad: el runtime Sprint 2 F8 ya rechaza 429, pero
  // evitamos el round-trip inútil desde server action.
  const rl = limiter("validator-manual", 3, "1 h");
  if (!rl) return { ok: true };
  const r = await rl.limit(tenantId);
  return r.success ? { ok: true } : { ok: false, reset: r.reset };
}

/**
 * Reseller program (F1):
 * - 50 touches/h por slug de reseller (anti cookie-stuffing dirigido a un reseller)
 * - Bucket por userId para endpoints admin/reseller (crear, aprobar, etc.)
 */
export async function limitByResellerSlug(
  slug: string,
): Promise<{ ok: true } | { ok: false; reset: number }> {
  const rl = limiter("reseller-slug", 50, "1 h");
  if (!rl) return { ok: true };
  const r = await rl.limit(slug);
  return r.success ? { ok: true } : { ok: false, reset: r.reset };
}

type UserBucket = "reseller_create" | "reseller_approve" | "payout_approve" | "connect_start";

export async function limitByUserId(
  userId: string,
  bucket: UserBucket,
  limit: number,
  window: Parameters<typeof Ratelimit.slidingWindow>[1],
): Promise<{ ok: true } | { ok: false; reset: number }> {
  const rl = limiter(`user-${bucket}`, limit, window);
  if (!rl) return { ok: true };
  const r = await rl.limit(userId);
  return r.success ? { ok: true } : { ok: false, reset: r.reset };
}

/**
 * Login con password (013): anti-brute-force.
 * - 5 intentos/15min por email. Email en lowercase para no escapar con mayúsculas.
 * - Defensa en profundidad: argon2id ya es lento, pero así evitamos ocupar
 *   CPU verificando hashes en ataques masivos.
 */
export async function limitByEmailLogin(
  email: string,
): Promise<{ ok: true } | { ok: false; reset: number }> {
  const rl = limiter("login-password", 5, "15 m");
  if (!rl) return { ok: true };
  const r = await rl.limit(email.toLowerCase().trim());
  return r.success ? { ok: true } : { ok: false, reset: r.reset };
}

/**
 * Registro (013): anti-spam cuenta nueva.
 * - 5 registros/hora por IP. Margen para equipos detrás de mismo NAT.
 */
export async function limitByIpRegister(
  ip: string,
): Promise<{ ok: true } | { ok: false; reset: number }> {
  const rl = limiter("register-ip", 5, "1 h");
  if (!rl) return { ok: true };
  const r = await rl.limit(ip);
  return r.success ? { ok: true } : { ok: false, reset: r.reset };
}

/** Devuelve true si Upstash está configurado (útil para logs/health). */
export function rateLimitConfigured(): boolean {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}
