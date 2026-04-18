// web/lib/reseller/anon-id.ts
// Hashes determinísticos pseudónimos para atribución server-side (dual-write
// vs cookie ordy_ref). Privacy-first: IP y UA nunca se guardan en claro.

import { createHash } from "node:crypto";

/**
 * Hash del IP con salt para dedup/lookup sin almacenar IP plaintext.
 * Mismo salt → mismo hash (determinístico para lookup por anon_id).
 */
export function hashIp(ip: string): string {
  const salt = process.env.IP_HASH_SALT ?? "ordy-default-salt-change-me";
  return createHash("sha256").update(`${ip}::${salt}`).digest("hex");
}

/**
 * anon_id = sha256(ipHash + ua + YYYY-MM-DD).
 * El bucket diario UTC evita trackear al mismo visitor a largo plazo y limita
 * la ventana de correlación a 1 día. Combinado con retención 30d = privacy OK.
 */
export function computeAnonId(ipHash: string, userAgent: string | null | undefined): string {
  const bucket = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
  const ua = (userAgent ?? "").slice(0, 500);
  return createHash("sha256").update(`${ipHash}::${ua}::${bucket}`).digest("hex");
}
