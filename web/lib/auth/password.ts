// web/lib/auth/password.ts — argon2id password hashing para Credentials provider.
//
// Params OWASP 2023 para argon2id:
//   memoryCost 19456 (19 MiB), timeCost 2, parallelism 1.
// @node-rs/argon2 usa defaults razonables; parametrizamos para dejar rastro
// de decisión y para poder subir coste en migraciones futuras sin re-hash.

import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";

const PARAMS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  // variant 2 = argon2id (default en @node-rs/argon2).
} as const;

export async function hashPassword(plain: string): Promise<string> {
  if (typeof plain !== "string" || plain.length < 8) {
    throw new Error("password must be ≥ 8 characters");
  }
  if (plain.length > 256) {
    throw new Error("password too long");
  }
  return argonHash(plain, PARAMS);
}

// constant-time verify vía @node-rs/argon2. Nunca logear `hash` ni `plain`.
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  if (!hash || typeof plain !== "string") return false;
  try {
    return await argonVerify(hash, plain);
  } catch {
    // Hash corrupto o formato inesperado → tratar como no-match.
    return false;
  }
}
