# runtime/app/crypto.py — Cifrado de credenciales (compatible con web/lib/crypto.ts)
#
# Usa AES-256-GCM con la clave de ENCRYPTION_KEY (32 bytes en base64).
# Formato almacenado: base64(nonce || ciphertext || tag) — 12 + N + 16 bytes.
# El web hace lo MISMO con Node crypto. Mantener compatibilidad bit-a-bit.

import base64
import os
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def _load_key() -> bytes:
    raw = os.getenv("ENCRYPTION_KEY", "")
    if not raw:
        raise RuntimeError("ENCRYPTION_KEY no configurada")
    key = base64.b64decode(raw)
    if len(key) != 32:
        raise RuntimeError(f"ENCRYPTION_KEY debe ser 32 bytes (got {len(key)})")
    return key


def descifrar(token_b64: str) -> str:
    """Descifra un string cifrado por web/lib/crypto.ts y devuelve el texto plano."""
    if not token_b64:
        return ""
    raw = base64.b64decode(token_b64)
    nonce, body = raw[:12], raw[12:]
    plain = AESGCM(_load_key()).decrypt(nonce, body, None)
    return plain.decode("utf-8")


def cifrar(texto: str) -> str:
    """Cifra un string. Útil para scripts de mantenimiento."""
    nonce = os.urandom(12)
    body = AESGCM(_load_key()).encrypt(nonce, texto.encode("utf-8"), None)
    return base64.b64encode(nonce + body).decode("ascii")
