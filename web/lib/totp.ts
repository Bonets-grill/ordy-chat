// web/lib/totp.ts — Helpers TOTP RFC 6238 sobre la lib `otpauth`.
//
// Mig 047. Solo se usa para 2FA de super_admin en aprobación de payouts.
// El secret se persiste cifrado con AES-256-GCM (helpers cifrar/descifrar).

import { Secret, TOTP } from "otpauth";
import { cifrar, descifrar } from "./crypto";

const ISSUER = "Ordy Chat";
const ALGORITHM = "SHA1";
const DIGITS = 6;
const PERIOD_S = 30;
// Aceptamos -1, 0, +1 windows para cubrir clock drift moderado.
const WINDOW = 1;

function totpFor(secret: Secret, label: string): TOTP {
  return new TOTP({
    issuer: ISSUER,
    label,
    algorithm: ALGORITHM,
    digits: DIGITS,
    period: PERIOD_S,
    secret,
  });
}

/** Genera un secret nuevo en base32 + URI otpauth para QR. */
export function generateTotpSecret(label: string): {
  secretBase32: string;
  otpauthUri: string;
} {
  const secret = new Secret({ size: 20 });
  const totp = totpFor(secret, label);
  return {
    secretBase32: secret.base32,
    otpauthUri: totp.toString(),
  };
}

/** Encripta un secret base32 para persistirlo. */
export function encryptTotpSecret(secretBase32: string): string {
  return cifrar(secretBase32);
}

/** Verifica un token de 6 dígitos contra un secret cifrado. */
export function verifyTotpToken(
  encryptedSecret: string,
  token: string,
  label: string,
): boolean {
  if (!/^\d{6}$/.test(token)) return false;
  let secretBase32: string;
  try {
    secretBase32 = descifrar(encryptedSecret);
  } catch {
    return false;
  }
  const totp = totpFor(Secret.fromBase32(secretBase32), label);
  const delta = totp.validate({ token, window: WINDOW });
  return delta !== null;
}
