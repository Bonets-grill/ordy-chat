// web/lib/crypto.ts — AES-256-GCM compatible con runtime/app/crypto.py
//
// Formato almacenado: base64(nonce(12) || ciphertext(N) || authTag(16))

import crypto from "node:crypto";

function loadKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error("ENCRYPTION_KEY no configurada");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(`ENCRYPTION_KEY debe ser 32 bytes (got ${key.length})`);
  }
  return key;
}

export function cifrar(texto: string): string {
  if (!texto) return "";
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", loadKey(), nonce);
  const ciphertext = Buffer.concat([cipher.update(texto, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([nonce, ciphertext, authTag]).toString("base64");
}

export function descifrar(tokenB64: string): string {
  if (!tokenB64) return "";
  const raw = Buffer.from(tokenB64, "base64");
  const nonce = raw.subarray(0, 12);
  const authTag = raw.subarray(raw.length - 16);
  const ciphertext = raw.subarray(12, raw.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", loadKey(), nonce);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function generarKey(): string {
  return crypto.randomBytes(32).toString("base64");
}
