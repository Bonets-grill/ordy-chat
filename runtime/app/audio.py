"""Transcripción de audios WhatsApp con Whisper (OpenAI).

WhatsApp entrega audios grabados (tipo 'voice') y attachments ('audio') con
mime normalmente 'audio/ogg; codecs=opus'. Whisper API de OpenAI acepta
directamente ese formato hasta 25 MB por llamada.

Patrón de resolución de API key replica `obtener_anthropic_api_key`:
  1. tenant.credentials['openai_api_key'] (override per-tenant)
  2. env OPENAI_API_KEY (prod estándar)
  3. platform_settings WHERE key='openai_api_key' (global cifrado)

El fallo a cualquier nivel deja pasar la excepción al caller, que debe
decidir qué decir al usuario (ej. main.py responde "no pude procesar audio").
"""

from __future__ import annotations

import logging
import os
from io import BytesIO
from typing import Any

from openai import AsyncOpenAI

logger = logging.getLogger("ordychat.audio")

MAX_AUDIO_BYTES = 25 * 1024 * 1024  # 25 MB, límite API Whisper
WHISPER_MODEL = "whisper-1"

_MIME_EXT = {
    "audio/ogg": "ogg",
    "audio/opus": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/mp4": "mp4",
    "audio/m4a": "m4a",
    "audio/x-m4a": "m4a",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/webm": "webm",
    "audio/flac": "flac",
}


class AudioTooLargeError(ValueError):
    """El audio supera el límite de Whisper API (25 MB)."""


class OpenAIKeyMissingError(RuntimeError):
    """OPENAI_API_KEY no configurada en ninguna fuente."""


def _ext_from_mime(mime: str | None) -> str:
    """Devuelve la extensión correcta para OpenAI SDK. Default 'ogg' porque
    WhatsApp voice es ogg-opus en la mayoría de casos."""
    if not mime:
        return "ogg"
    base = mime.split(";")[0].strip().lower()
    return _MIME_EXT.get(base, "ogg")


async def transcribir_audio(
    audio_bytes: bytes,
    mime: str | None,
    api_key: str,
    language: str = "es",
) -> str:
    """Transcribe un audio con Whisper. Devuelve el texto trimmed.

    Args:
        audio_bytes: contenido binario del audio tal como lo entregó el provider.
        mime: content-type para determinar la extensión que espera la API.
        api_key: OpenAI API key ya resuelta.
        language: hint ISO-639-1. Default 'es' mejora precisión en España.

    Raises:
        AudioTooLargeError: si audio_bytes > MAX_AUDIO_BYTES.
        Otros: propagados desde openai SDK (rate limit, auth, etc).
    """
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        raise AudioTooLargeError(
            f"audio {len(audio_bytes)} bytes supera el límite {MAX_AUDIO_BYTES}",
        )

    ext = _ext_from_mime(mime)
    # openai SDK usa `.name` del file-like para detectar formato en el multipart.
    buffer = BytesIO(audio_bytes)
    buffer.name = f"audio.{ext}"

    client = AsyncOpenAI(api_key=api_key, timeout=45.0, max_retries=2)
    resp: Any = await client.audio.transcriptions.create(
        model=WHISPER_MODEL,
        file=buffer,
        language=language,
    )
    texto = (getattr(resp, "text", "") or "").strip()
    logger.info(
        "audio transcrito",
        extra={
            "event": "whisper_ok",
            "bytes": len(audio_bytes),
            "mime": mime,
            "chars": len(texto),
        },
    )
    return texto


async def obtener_openai_api_key(credentials: dict | None) -> str:
    """Resuelve la key OpenAI con la misma precedencia que la Anthropic.

    Raises:
        OpenAIKeyMissingError si ninguna fuente la tiene.
    """
    if credentials and isinstance(credentials, dict):
        k = credentials.get("openai_api_key")
        if k:
            return k

    env_key = os.getenv("OPENAI_API_KEY")
    if env_key:
        return env_key

    # Último recurso: platform_settings cifrado (lo configura super admin).
    try:
        from app.crypto import descifrar
        from app.memory import inicializar_pool
    except ImportError:
        raise OpenAIKeyMissingError("no hay openai_api_key y no se pudieron cargar helpers")

    pool = await inicializar_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT value_encrypted FROM platform_settings WHERE key = 'openai_api_key' LIMIT 1",
        )
    if row and row["value_encrypted"]:
        try:
            return descifrar(row["value_encrypted"])
        except Exception as e:
            raise OpenAIKeyMissingError(f"platform_settings.openai_api_key no se pudo descifrar: {e}")

    raise OpenAIKeyMissingError(
        "OPENAI_API_KEY no configurada (ni credentials, ni env, ni platform_settings)"
    )
