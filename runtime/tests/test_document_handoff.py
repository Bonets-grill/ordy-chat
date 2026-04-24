"""PR #101 — Documento adjunto (PDF/DOCX/XLSX/video) → handoff directo.

Comportamiento esperado cuando llega un mensaje con `tipo_no_texto="document"`:
  1. El bot NO envía el fallback "solo sé leer texto e imágenes".
  2. Se invoca `crear_handoff` con reason que menciona el documento.
  3. Se invoca `_auto_pausar_bot` con reason="document_handoff" y 1440 min (24h).
  4. El cliente recibe un ACK corto que incluye "documento" y "📎".
  5. `manejar_admin_flow` NUNCA se alcanza (retorno temprano).

Mismo patrón que test_audio_webhook_flow.py pero para la rama opuesta.
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
async def test_documento_dispara_handoff_directo_sin_pasar_por_bot() -> None:
    from app import main as main_mod

    tenant = _build_tenant()
    msg = MensajeEntrante(
        telefono="34600111222",
        texto="",
        mensaje_id="wa-msg-doc-1",
        es_propio=False,
        tipo_no_texto="document",
        media_ref="fake-doc-key",
        caption="presupuesto para 40 personas",
    )

    adapter = SimpleNamespace(
        descargar_media=AsyncMock(return_value=None),
        enviar_mensaje=AsyncMock(return_value=True),
        enviar_presence_typing=AsyncMock(return_value=None),
    )

    admin_calls: list[str] = []

    async def _fake_admin_flow(pool, _tenant, phone, texto, mid, enviar):  # noqa: ARG001
        admin_calls.append(texto)
        return True

    crear_handoff_mock = AsyncMock(return_value={"ok": True, "handoff_id": "abc"})
    auto_pausar_mock = AsyncMock(return_value=None)
    guardar_mock = AsyncMock(return_value=None)

    with (
        patch.object(main_mod, "ya_procesado", AsyncMock(return_value=False)),
        patch.object(main_mod, "obtener_proveedor", return_value=adapter),
        patch.object(main_mod, "esperar_con_warmup", AsyncMock(return_value={"blocked": False})),
        patch.object(main_mod, "manejar_admin_flow", side_effect=_fake_admin_flow),
        patch.object(main_mod, "_auto_pausar_bot", auto_pausar_mock),
        patch.object(main_mod, "guardar_intercambio", guardar_mock),
        patch("app.agent_tools.crear_handoff", crear_handoff_mock),
    ):
        await main_mod._procesar_mensaje(tenant, "evolution", msg)

    # 1) crear_handoff invocado una vez con el tenant y teléfono correctos y
    #    con un reason que menciona la nota del cliente.
    assert crear_handoff_mock.await_count == 1, "crear_handoff debió invocarse exactamente 1 vez"
    call_kwargs = crear_handoff_mock.await_args.kwargs
    assert call_kwargs["tenant_id"] == tenant.id
    assert call_kwargs["customer_phone"] == "34600111222"
    assert "documento" in call_kwargs["reason"].lower()
    assert "presupuesto para 40 personas" in call_kwargs["reason"]

    # 2) _auto_pausar_bot invocado con 24h (1440 min) y reason document_handoff.
    assert auto_pausar_mock.await_count == 1
    pos_args = auto_pausar_mock.await_args.args
    kw = auto_pausar_mock.await_args.kwargs
    assert pos_args[0] == tenant.id
    assert pos_args[1] == "34600111222"
    assert pos_args[2] == 60 * 24
    assert kw.get("reason") == "document_handoff"

    # 3) Cliente recibió el ACK: contiene "documento" y "📎".
    sent_texts = [call.args[1] for call in adapter.enviar_mensaje.call_args_list]
    assert len(sent_texts) == 1, f"se esperaba 1 envío (ACK), hubo {len(sent_texts)}: {sent_texts}"
    assert "documento" in sent_texts[0].lower()
    assert "📎" in sent_texts[0]

    # 4) Fallback "solo sé leer texto" NO se disparó.
    assert all("solo sé leer texto" not in t for t in sent_texts), sent_texts

    # 5) admin_flow nunca se alcanzó (retorno temprano tras el handoff).
    assert admin_calls == [], f"admin_flow no debía alcanzarse: {admin_calls}"

    # 6) Se guardó el intercambio para que aparezca en historial.
    assert guardar_mock.await_count == 1


@pytest.mark.asyncio
async def test_video_tambien_dispara_handoff_directo() -> None:
    """Simétrico al test anterior: tipo_no_texto='video' también → handoff."""
    from app import main as main_mod

    tenant = _build_tenant()
    msg = MensajeEntrante(
        telefono="34600333444",
        texto="",
        mensaje_id="wa-msg-vid-1",
        es_propio=False,
        tipo_no_texto="video",
        media_ref="fake-vid-key",
        caption=None,
    )

    adapter = SimpleNamespace(
        descargar_media=AsyncMock(return_value=None),
        enviar_mensaje=AsyncMock(return_value=True),
        enviar_presence_typing=AsyncMock(return_value=None),
    )

    crear_handoff_mock = AsyncMock(return_value={"ok": True, "handoff_id": "xyz"})
    auto_pausar_mock = AsyncMock(return_value=None)
    guardar_mock = AsyncMock(return_value=None)

    with (
        patch.object(main_mod, "ya_procesado", AsyncMock(return_value=False)),
        patch.object(main_mod, "obtener_proveedor", return_value=adapter),
        patch.object(main_mod, "esperar_con_warmup", AsyncMock(return_value={"blocked": False})),
        patch.object(main_mod, "manejar_admin_flow", AsyncMock(return_value=True)),
        patch.object(main_mod, "_auto_pausar_bot", auto_pausar_mock),
        patch.object(main_mod, "guardar_intercambio", guardar_mock),
        patch("app.agent_tools.crear_handoff", crear_handoff_mock),
    ):
        await main_mod._procesar_mensaje(tenant, "evolution", msg)

    assert crear_handoff_mock.await_count == 1
    assert "vídeo" in crear_handoff_mock.await_args.kwargs["reason"].lower()

    sent_texts = [call.args[1] for call in adapter.enviar_mensaje.call_args_list]
    assert len(sent_texts) == 1
    assert "vídeo" in sent_texts[0].lower()


@pytest.mark.asyncio
async def test_sticker_mantiene_fallback_canned() -> None:
    """Sticker NO dispara handoff — sigue el comportamiento antiguo."""
    from app import main as main_mod

    tenant = _build_tenant()
    msg = MensajeEntrante(
        telefono="34600555666",
        texto="",
        mensaje_id="wa-msg-stk-1",
        es_propio=False,
        tipo_no_texto="sticker",
        media_ref=None,
    )

    adapter = SimpleNamespace(
        descargar_media=AsyncMock(return_value=None),
        enviar_mensaje=AsyncMock(return_value=True),
    )

    crear_handoff_mock = AsyncMock(return_value={"ok": True})

    with (
        patch.object(main_mod, "ya_procesado", AsyncMock(return_value=False)),
        patch.object(main_mod, "obtener_proveedor", return_value=adapter),
        patch.object(main_mod, "esperar_con_warmup", AsyncMock(return_value={"blocked": False})),
        patch("app.agent_tools.crear_handoff", crear_handoff_mock),
    ):
        await main_mod._procesar_mensaje(tenant, "evolution", msg)

    assert crear_handoff_mock.await_count == 0, "sticker NO debería disparar handoff"
    sent_texts = [call.args[1] for call in adapter.enviar_mensaje.call_args_list]
    assert any("solo sé leer texto" in t for t in sent_texts), sent_texts
