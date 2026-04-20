"""Regresión: audio transcrito debe atravesar el fallback de 'solo texto e imágenes'.

Bug original (pre-fix, runtime/app/main.py): tras transcribir un audio con
Whisper, el flujo caía en `if not media_blocks:` (diseñado para video/doc/
sticker) y respondía al usuario "solo sé leer texto e imágenes", descartando
la transcripción. El admin flow y el cliente flow nunca se alcanzaban.

Este test exercita `_procesar_mensaje` con un audio mockeado y verifica que:
  1. NO se envía el mensaje de media no soportada.
  2. El admin flow (o el cliente flow) recibe la transcripción como texto.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest

from app.providers.base import MensajeEntrante
from app.tenants import TenantContext


def _build_tenant() -> TenantContext:
    return TenantContext(
        id=uuid4(),
        slug="test-tenant",
        name="Test",
        subscription_status="active",
        paused=False,
        system_prompt="",
        fallback_message="",
        error_message="",
        max_messages_per_hour=100,
        provider="evolution",
        credentials={"instance_name": "x"},
        webhook_secret="",
    )


@pytest.mark.asyncio
async def test_audio_transcrito_no_cae_en_fallback_media_no_soportada() -> None:
    """Transcripción exitosa → flujo continúa hasta admin_flow (no fallback)."""
    from app import main as main_mod

    tenant = _build_tenant()
    msg = MensajeEntrante(
        telefono="34600000000",
        texto="",
        mensaje_id="wa-msg-123",
        es_propio=False,
        tipo_no_texto="audio",
        media_ref="fake-media-id",
    )

    adapter = SimpleNamespace(
        descargar_media=AsyncMock(return_value=(b"fake-ogg-bytes", "audio/ogg; codecs=opus")),
        enviar_mensaje=AsyncMock(return_value=True),
        enviar_presence_typing=AsyncMock(return_value=None),
    )

    # manejar_admin_flow es el primer punto DESPUÉS de la rama audio al que
    # el bug impedía llegar. Si se invoca, el fix funciona.
    admin_calls: list[str] = []

    async def _fake_admin_flow(pool, _tenant, phone, texto, mid, enviar):  # noqa: ARG001
        admin_calls.append(texto)
        # Devolver True para que main.py retorne en el if admin_took (line 554-559)
        # y el flujo NO siga a paused_conversations/generar_respuesta (no mockeados).
        return True

    with (
        patch.object(main_mod, "ya_procesado", AsyncMock(return_value=False)),
        patch.object(main_mod, "obtener_proveedor", return_value=adapter),
        patch.object(main_mod, "limite_superado", AsyncMock(return_value=False)),
        patch.object(main_mod, "obtener_historial", AsyncMock(return_value=[])),
        patch.object(main_mod, "inicializar_pool", AsyncMock(return_value=SimpleNamespace())),
        patch.object(main_mod, "esperar_con_warmup", AsyncMock(return_value={"blocked": False})),
        patch.object(main_mod, "manejar_admin_flow", side_effect=_fake_admin_flow),
        patch("app.audio.obtener_openai_api_key", AsyncMock(return_value="sk-fake")),
        patch("app.audio.transcribir_audio", AsyncMock(return_value="quita la dakota")),
    ):
        await main_mod._procesar_mensaje(tenant, "evolution", msg)

    # 1) El admin flow recibió la transcripción como texto efectivo.
    assert admin_calls == ["quita la dakota"]

    # 2) Ninguna llamada a enviar_mensaje puede contener la frase del fallback.
    sent_texts = [call.args[1] for call in adapter.enviar_mensaje.call_args_list]
    assert all("solo sé leer texto" not in t for t in sent_texts), (
        f"Fallback 'media no soportada' se disparó tras transcripción exitosa: {sent_texts}"
    )
