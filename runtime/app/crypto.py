# runtime/app/crypto.py — Cifrado de credenciales (compatible con web/lib/crypto.ts)
#
# AES-256-GCM. Formato almacenado: base64(nonce(12) || ciphertext(N) || tag(16)).
# Compatibilidad bit-a-bit con Node crypto en web/lib/crypto.ts.

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
    """Descifra un string cifrado por web/lib/crypto.ts. Lanza excepción si falla."""
    if not token_b64:
        raise ValueError("descifrar: token vacío")
    raw = base64.b64decode(token_b64)
    if len(raw) < 28:
        raise ValueError(f"descifrar: payload demasiado corto ({len(raw)} bytes)")
    nonce, body = raw[:12], raw[12:]
    plain = AESGCM(_load_key()).decrypt(nonce, body, None)
    return plain.decode("utf-8")


def cifrar(texto: str) -> str:
    """Cifra un string. Útil para scripts de mantenimiento."""
    nonce = os.urandom(12)
    body = AESGCM(_load_key()).encrypt(nonce, texto.encode("utf-8"), None)
    return base64.b64encode(nonce + body).decode("ascii")
