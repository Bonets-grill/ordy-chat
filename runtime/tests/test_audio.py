"""Tests del módulo audio (Whisper wrapper).

No llamamos a Whisper real — mockeamos AsyncOpenAI para verificar que
transcribir_audio pasa bytes, mime, language y parsea la respuesta bien.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.audio import (
    MAX_AUDIO_BYTES,
    AudioTooLargeError,
    OpenAIKeyMissingError,
    _ext_from_mime,
    es_alucinacion_whisper,
    obtener_openai_api_key,
    transcribir_audio,
)


def test_ext_from_mime_whatsapp_voice() -> None:
    # Evolution entrega "audio/ogg; codecs=opus" para PTT.
    assert _ext_from_mime("audio/ogg; codecs=opus") == "ogg"
    assert _ext_from_mime("audio/ogg") == "ogg"
    assert _ext_from_mime("audio/mpeg") == "mp3"
    assert _ext_from_mime("audio/m4a") == "m4a"
    assert _ext_from_mime("audio/wav") == "wav"
    # Mime vacío o desconocido → default ogg (lo más habitual en WA).
    assert _ext_from_mime(None) == "ogg"
    assert _ext_from_mime("") == "ogg"
    assert _ext_from_mime("audio/weird-codec") == "ogg"


def test_ext_from_mime_case_insensitive() -> None:
    assert _ext_from_mime("AUDIO/OGG; CODECS=OPUS") == "ogg"


@pytest.mark.asyncio
async def test_transcribir_audio_rechaza_demasiado_grande() -> None:
    big = b"x" * (MAX_AUDIO_BYTES + 1)
    with pytest.raises(AudioTooLargeError):
        await transcribir_audio(big, "audio/ogg", api_key="sk-fake")


@pytest.mark.asyncio
async def test_transcribir_audio_usa_whisper_con_lang_es() -> None:
    fake_resp = SimpleNamespace(text="Quita la dakota del menú")
    mock_create = AsyncMock(return_value=fake_resp)
    # Patch del constructor AsyncOpenAI → devuelve un objeto con
    # audio.transcriptions.create mockeado.
    fake_client = SimpleNamespace(
        audio=SimpleNamespace(transcriptions=SimpleNamespace(create=mock_create)),
    )
    with patch("app.audio.AsyncOpenAI", return_value=fake_client) as mock_ctor:
        result = await transcribir_audio(
            b"fake-ogg-bytes", "audio/ogg; codecs=opus", api_key="sk-fake",
        )
    assert result == "Quita la dakota del menú"
    mock_ctor.assert_called_once()
    # Verificar que openai recibió model whisper-1 + lang es.
    call_kwargs = mock_create.call_args.kwargs
    assert call_kwargs["model"] == "whisper-1"
    assert call_kwargs["language"] == "es"
    # Verificar que el file-like tiene extensión .ogg.
    assert call_kwargs["file"].name.endswith(".ogg")


@pytest.mark.asyncio
async def test_transcribir_audio_strip_whitespace() -> None:
    fake_resp = SimpleNamespace(text="  texto con espacios  \n")
    fake_client = SimpleNamespace(
        audio=SimpleNamespace(transcriptions=SimpleNamespace(
            create=AsyncMock(return_value=fake_resp),
        )),
    )
    with patch("app.audio.AsyncOpenAI", return_value=fake_client):
        result = await transcribir_audio(b"x", "audio/ogg", "sk-fake")
    assert result == "texto con espacios"


@pytest.mark.asyncio
async def test_transcribir_audio_respuesta_vacia() -> None:
    # Whisper puede devolver "" si el audio no tiene speech.
    fake_resp = SimpleNamespace(text="")
    fake_client = SimpleNamespace(
        audio=SimpleNamespace(transcriptions=SimpleNamespace(
            create=AsyncMock(return_value=fake_resp),
        )),
    )
    with patch("app.audio.AsyncOpenAI", return_value=fake_client):
        result = await transcribir_audio(b"x", "audio/ogg", "sk-fake")
    assert result == ""


class TestEsAlucinacionWhisper:
    """Cubre el filtro post-Whisper que descarta alucinaciones sobre silencio."""

    @pytest.mark.parametrize(
        "texto",
        [
            "Subtítulos realizados por la comunidad de Amara.org",
            "subtítulos realizados por la comunidad de amara.org",
            "SUBTITULOS REALIZADOS POR LA COMUNIDAD DE AMARA.ORG",
            "Subtítulos por la comunidad de Amara.org",
            "Subtitulado por la comunidad de Amara.org",
            "www.amara.org",
            "Amara.org",
            "¡Gracias por ver el video!",
            "Gracias por ver el vídeo.",
            "Suscríbete al canal",
            "Dale like y suscríbete",
            "Thanks for watching!",
            "Thank you for watching",
            "Please subscribe",
            ".",
            "...",
            "♪",
            "[Música]",
            "[music]",
            "you",
            "  You.  ",
        ],
    )
    def test_detecta_alucinaciones_conocidas(self, texto: str) -> None:
        assert es_alucinacion_whisper(texto), f"debería filtrar: {texto!r}"

    @pytest.mark.parametrize(
        "texto",
        [
            "Quiero una hamburguesa con queso",
            "Mesa para dos, por favor",
            "¿Tenéis opciones sin gluten?",
            "Una coca-cola y dos aguas",
            "Gracias por la reserva",  # no es la alucinación exacta
            "Me gustaría hablar con un camarero",
        ],
    )
    def test_no_filtra_mensajes_reales(self, texto: str) -> None:
        assert not es_alucinacion_whisper(texto), f"no debería filtrar: {texto!r}"

    def test_vacio_no_es_alucinacion(self) -> None:
        # "" lo trata el caller — es_alucinacion_whisper devuelve False para
        # preservar la semántica "este texto no es una alucinación, es nada".
        assert es_alucinacion_whisper("") is False

    def test_solo_puntuacion_es_alucinacion(self) -> None:
        assert es_alucinacion_whisper("...") is True
        assert es_alucinacion_whisper("?¿!¡.,;:") is True


@pytest.mark.asyncio
async def test_transcribir_audio_filtra_alucinacion_amara() -> None:
    # Reproduce el incidente prod 2026-04-23: cliente tocó el mic en silencio,
    # Whisper devolvió créditos de YouTube, el chat los mostró como mensaje
    # del cliente. El filtro debe devolver "" sin llegar al caller.
    fake_resp = SimpleNamespace(
        text="Subtítulos realizados por la comunidad de Amara.org",
    )
    fake_client = SimpleNamespace(
        audio=SimpleNamespace(transcriptions=SimpleNamespace(
            create=AsyncMock(return_value=fake_resp),
        )),
    )
    with patch("app.audio.AsyncOpenAI", return_value=fake_client):
        result = await transcribir_audio(b"x", "audio/webm", "sk-fake")
    assert result == ""


@pytest.mark.asyncio
async def test_transcribir_audio_no_filtra_mensaje_real() -> None:
    fake_resp = SimpleNamespace(text="Quiero una hamburguesa")
    fake_client = SimpleNamespace(
        audio=SimpleNamespace(transcriptions=SimpleNamespace(
            create=AsyncMock(return_value=fake_resp),
        )),
    )
    with patch("app.audio.AsyncOpenAI", return_value=fake_client):
        result = await transcribir_audio(b"x", "audio/webm", "sk-fake")
    assert result == "Quiero una hamburguesa"


@pytest.mark.asyncio
async def test_obtener_openai_api_key_credentials_tiene_prioridad() -> None:
    # Orden: credentials > env > platform_settings.
    key = await obtener_openai_api_key({"openai_api_key": "sk-from-credentials"})
    assert key == "sk-from-credentials"


@pytest.mark.asyncio
async def test_obtener_openai_api_key_sin_credentials_usa_env(monkeypatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "sk-from-env")
    key = await obtener_openai_api_key(None)
    assert key == "sk-from-env"
    key = await obtener_openai_api_key({})
    assert key == "sk-from-env"


@pytest.mark.asyncio
async def test_obtener_openai_api_key_sin_nada_lanza(monkeypatch) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    # Patch inicializar_pool + fetchrow → no hay platform_settings.
    async def fake_inicializar_pool():
        class FakePool:
            def acquire(self):
                class Ctx:
                    async def __aenter__(self_):
                        class Conn:
                            async def fetchrow(self_c, *a, **k):
                                return None
                        return Conn()
                    async def __aexit__(self_, *a):
                        return False
                return Ctx()
        return FakePool()
    with patch("app.memory.inicializar_pool", fake_inicializar_pool):
        with pytest.raises(OpenAIKeyMissingError):
            await obtener_openai_api_key({})
