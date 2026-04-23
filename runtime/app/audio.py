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

# Whisper alucina frases de su corpus de entrenamiento (sobre todo créditos
# de YouTube en ES/EN) cuando recibe audio corto, silencio o ruido sin
# habla. Este filtro devuelve "" en esos casos para que el caller no trate
# la alucinación como un mensaje real del usuario. Incidente prod 2026-04-23:
# un cliente del widget público recibió la frase "Subtítulos realizados por
# la comunidad de Amara.org" como si la hubiera dicho él.
_WHISPER_HALLUCINATIONS: frozenset[str] = frozenset(
    {
        # YouTube credits (ES)
        "subtitulos realizados por la comunidad de amara.org",
        "subtitulos por la comunidad de amara.org",
        "subtitulos realizados por amara.org",
        "subtitulado por la comunidad de amara.org",
        "subtitulos creados por la comunidad de amara.org",
        "subtitulos por la comunidad",
        "www.amara.org",
        "amara.org",
        # Cierres virales (ES)
        "gracias por ver el video",
        "gracias por ver el vídeo",
        "muchas gracias por ver el video",
        "suscribete al canal",
        "suscribanse al canal",
        "dale like y suscribete",
        "no olvides suscribirte",
        # YouTube credits (EN) — el idioma de Whisper puede fugarse aunque lang=es
        "thanks for watching",
        "thanks for watching!",
        "thank you for watching",
        "thank you for watching!",
        "please subscribe",
        "subscribe to the channel",
        "like and subscribe",
        # Ruido / música / silencio
        ".",
        "..",
        "...",
        "♪",
        "♪♪",
        "♪♪♪",
        "[music]",
        "[musica]",
        "[música]",
        "[silence]",
        "[silencio]",
        "[applause]",
        "[aplausos]",
        "you",  # alucinación frecuente de Whisper en silencio
    }
)


def _normaliza_texto_para_alucinacion(texto: str) -> str:
    """Pasa a minúsculas, strip y elimina acentos. Preserva corchetes porque
    Whisper los emite literal cuando detecta ruido (`[Music]`, `[Silence]`)."""
    import unicodedata

    base = texto.strip().lower()
    # Strip puntuación blanda de ambos lados, sin tocar corchetes ni interior.
    base = base.strip(".!?¡¿,;:'\"")
    base = base.strip()
    # Normaliza acentos: "subtítulos" → "subtitulos" para match robusto.
    nfkd = unicodedata.normalize("NFKD", base)
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def es_alucinacion_whisper(texto: str) -> bool:
    """True si el texto es una alucinación conocida de Whisper sobre silencio.

    Match directo contra lista canónica + heurística para frases que siempre
    implican alucinación (mención de amara.org o subtítulos+comunidad).
    """
    if not texto:
        return False
    norm = _normaliza_texto_para_alucinacion(texto)
    if not norm:
        return True  # sólo puntuación → ruido
    if norm in _WHISPER_HALLUCINATIONS:
        return True
    if "amara.org" in norm:
        return True
    if "subtitulos" in norm and ("comunidad" in norm or "amara" in norm):
        return True
    return False


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
    # Prompt de contexto: Whisper usa esto como seed para orientar la
    # transcripción. Útil en conversaciones de restaurante donde el ASR
    # tiende a alucinar nombres inventados ("Phoenix", "Mario", etc.)
    # cuando el audio es corto o con ruido. Max 224 tokens según OpenAI.
    # temperature=0 para minimizar variabilidad.
    whisper_prompt = (
        "Conversación en un restaurante entre cliente y camarero. El cliente "
        "hace pedidos, pide la carta, reserva mesa. Menciona hamburguesas, "
        "entrantes, bebidas, postres. Idioma español neutro. Transcribe "
        "solo lo que dice el cliente — ignora música, eco, o frases "
        "genéricas de YouTube."
    )
    resp: Any = await client.audio.transcriptions.create(
        model=WHISPER_MODEL,
        file=buffer,
        language=language,
        prompt=whisper_prompt,
        temperature=0,
    )
    texto = (getattr(resp, "text", "") or "").strip()
    if es_alucinacion_whisper(texto):
        logger.info(
            "whisper hallucination filtrada",
            extra={
                "event": "whisper_hallucination_filtered",
                "bytes": len(audio_bytes),
                "mime": mime,
                "text_filtered": texto[:120],
            },
        )
        return ""
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
