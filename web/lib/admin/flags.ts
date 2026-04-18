// web/lib/admin/flags.ts — Feature flags con precedencia platform_settings > env > default.
//
// Storage: platform_settings.key = `flag.${key}` (prefijo "flag." evita colisión
// con API keys legacy que usa /admin/settings como anthropic_api_key).
// Serialización: JSON.stringify(value) → cifrar (AES-256-GCM) → value_encrypted.
// Lectura: descifrar → JSON.parse → Zod validar según FlagSpec.type.
// Fallback: env var (solo algunos flags la tienen) → default hardcoded.
//
// Cache in-memory 30s per server process. Invalidación explícita tras setFlag.

import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { cifrar, descifrar } from "@/lib/crypto";
import { db } from "@/lib/db";
import { platformSettings } from "@/lib/db/schema";

export type FlagKey = "onboarding_fast_enabled" | "validation_mode_default" | "warmup_enforce";

type FlagSpec =
  | {
      key: "onboarding_fast_enabled";
      type: "bool";
      default: false;
      envVar: "ONBOARDING_FAST_ENABLED";
      description: string;
    }
  | {
      key: "validation_mode_default";
      type: "enum";
      options: readonly ["auto", "manual", "skip"];
      default: "skip";
      envVar: null;
      description: string;
    }
  | {
      key: "warmup_enforce";
      type: "bool";
      default: true;
      envVar: null;
      description: string;
    };

export const FLAG_SPECS: readonly FlagSpec[] = [
  {
    key: "onboarding_fast_enabled",
    type: "bool",
    default: false,
    envVar: "ONBOARDING_FAST_ENABLED",
    description: "Redirect default /onboarding → /onboarding/fast.",
  },
  {
    key: "validation_mode_default",
    type: "enum",
    options: ["auto", "manual", "skip"] as const,
    default: "skip",
    envVar: null,
    description: "Modo del validador de agentes para tenants nuevos (Sprints 2-3).",
  },
  {
    key: "warmup_enforce",
    type: "bool",
    default: true,
    envVar: null,
    description: "Kill-switch emergencia: si false, warm-up NO bloquea envíos.",
  },
];

export const FLAG_KEY_PREFIX = "flag." as const;

function specOf(key: FlagKey): FlagSpec {
  const spec = FLAG_SPECS.find((s) => s.key === key);
  if (!spec) throw new Error(`unknown flag key: ${key}`);
  return spec;
}

// ─── Cache in-memory ────────────────────────────────────────

type CacheEntry = { value: unknown; expiresAt: number };
const _cache = new Map<FlagKey, CacheEntry>();
const CACHE_TTL_MS = 30_000;

export function invalidateFlagCache(key: FlagKey): void {
  _cache.delete(key);
}

export function _resetFlagCacheForTests(): void {
  _cache.clear();
}

// ─── Coerción env var ──────────────────────────────────────

function coerceEnv(raw: string, spec: FlagSpec): unknown | undefined {
  if (spec.type === "bool") {
    const norm = raw.trim().toLowerCase();
    if (norm === "true") return true;
    if (norm === "false" || norm === "") return false;
    // Valor raro: ignorar env, usar default.
    return undefined;
  }
  if (spec.type === "enum") {
    const norm = raw.trim();
    if ((spec.options as readonly string[]).includes(norm)) return norm;
    return undefined;
  }
  return undefined;
}

// ─── Validación Zod ────────────────────────────────────────

function zodForSpec(spec: FlagSpec): z.ZodType<unknown> {
  if (spec.type === "bool") return z.boolean();
  if (spec.type === "enum") return z.enum(spec.options as unknown as [string, ...string[]]);
  return z.unknown();
}

// ─── Lectura ───────────────────────────────────────────────

export async function getFlag<T = unknown>(key: FlagKey): Promise<T> {
  const cached = _cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value as T;
  }

  const spec = specOf(key);
  const storageKey = `${FLAG_KEY_PREFIX}${key}`;

  // 1. platform_settings
  let resolved: unknown | undefined;
  try {
    const [row] = await db
      .select()
      .from(platformSettings)
      .where(eq(platformSettings.key, storageKey))
      .limit(1);
    if (row?.valueEncrypted) {
      try {
        const decrypted = descifrar(row.valueEncrypted);
        const parsed = JSON.parse(decrypted);
        const zparsed = zodForSpec(spec).safeParse(parsed);
        if (zparsed.success) {
          resolved = zparsed.data;
        } else {
          console.warn("[flags] platform_settings value invalid for", key, zparsed.error.message);
        }
      } catch (e) {
        console.warn("[flags] failed to decrypt/parse flag", key, e);
      }
    }
  } catch (e) {
    console.warn("[flags] db read failed for", key, e);
  }

  // 2. env var
  if (resolved === undefined && spec.envVar) {
    const raw = process.env[spec.envVar];
    if (raw !== undefined) {
      const coerced = coerceEnv(raw, spec);
      if (coerced !== undefined) resolved = coerced;
    }
  }

  // 3. default
  if (resolved === undefined) {
    resolved = spec.default;
  }

  _cache.set(key, { value: resolved, expiresAt: Date.now() + CACHE_TTL_MS });
  return resolved as T;
}

// ─── Escritura ─────────────────────────────────────────────

export async function setFlag(key: FlagKey, value: unknown, updatedBy: string): Promise<void> {
  const spec = specOf(key);
  const zparsed = zodForSpec(spec).safeParse(value);
  if (!zparsed.success) {
    throw new Error(`VALIDATION: flag ${key} value inválido: ${zparsed.error.message}`);
  }
  const encrypted = cifrar(JSON.stringify(zparsed.data));
  const storageKey = `${FLAG_KEY_PREFIX}${key}`;

  await db
    .insert(platformSettings)
    .values({
      key: storageKey,
      valueEncrypted: encrypted,
      description: spec.description,
      updatedBy,
    })
    .onConflictDoUpdate({
      target: platformSettings.key,
      set: {
        valueEncrypted: encrypted,
        updatedBy,
        updatedAt: sql`now()`,
      },
    });

  invalidateFlagCache(key);
}

/** Útil para UI: leer todos los flags con su origen (settings|env|default). */
export async function listFlagStates(): Promise<
  Array<{
    key: FlagKey;
    type: FlagSpec["type"];
    description: string;
    value: unknown;
    source: "platform_settings" | "env" | "default";
    options?: readonly string[];
  }>
> {
  const result = [];
  for (const spec of FLAG_SPECS) {
    const storageKey = `${FLAG_KEY_PREFIX}${spec.key}`;
    let source: "platform_settings" | "env" | "default" = "default";
    let value: unknown = spec.default;

    try {
      const [row] = await db
        .select()
        .from(platformSettings)
        .where(eq(platformSettings.key, storageKey))
        .limit(1);
      if (row?.valueEncrypted) {
        try {
          const parsed = JSON.parse(descifrar(row.valueEncrypted));
          const zparsed = zodForSpec(spec).safeParse(parsed);
          if (zparsed.success) {
            value = zparsed.data;
            source = "platform_settings";
          }
        } catch {
          // fall through
        }
      }
    } catch (e) {
      console.warn("[flags] listFlagStates db read failed", e);
    }

    if (source === "default" && spec.envVar) {
      const raw = process.env[spec.envVar];
      if (raw !== undefined) {
        const coerced = coerceEnv(raw, spec);
        if (coerced !== undefined) {
          value = coerced;
          source = "env";
        }
      }
    }

    result.push({
      key: spec.key,
      type: spec.type,
      description: spec.description,
      value,
      source,
      options: spec.type === "enum" ? spec.options : undefined,
    });
  }
  return result;
}
