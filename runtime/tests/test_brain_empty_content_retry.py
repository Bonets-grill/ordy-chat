"""Regresión: cliente NO debe leer "problemas técnicos" cuando Claude
devuelve content=[] (caso Fabian, 2026-04-27 20:29 Atlantic/Canary).

Bug histórico:

  Cliente: "Fabian"  (turno 3, respuesta al "¿a qué nombre?")
  Claude : stop_reason='end_turn', content=[]   ← respuesta literalmente vacía
  Bot    : tenant.error_message → "Lo siento, estoy teniendo problemas
            técnicos. Intenta de nuevo en unos minutos."

El commit 85cbc8f (26-abr) cubrió el sub-caso "stop_reason mentiroso con
tool_use blocks pendientes". NO cubre el caso content totalmente vacío.

Defensa en profundidad:

  1. Si Claude devuelve content sin texto Y sin tool_use → RETRY 1×
     con temperature bumped (0.4) para romper el determinismo de la
     posible salida degenerada del modelo.
  2. Si la 2ª llamada también vacía → mensaje contextual al cliente
     en su idioma ("Disculpa, no he podido procesar tu último mensaje.
     ¿Puedes repetirlo?"), NUNCA "problemas técnicos".
  3. Auto-handoff sigue disparando como ya lo hace (commit 85cbc8f).

Tests behavioral con mock del cliente Anthropic.
"""

from __future__ import annotations

import asyncio
import inspect
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import UUID

import pytest

from app import brain


# ─────────────────────────────────────────────────────────────────────
# Helpers de fixture
# ─────────────────────────────────────────────────────────────────────


class _Tenant:
    id = UUID("00000000-0000-0000-0000-000000000099")
    slug = "fake-tenant"
    name = "Fake Tenant"
    subscription_status = "active"
    paused = False
    system_prompt = "Eres un asistente de prueba."
    fallback_message = "FALLBACK_VACIO"
    error_message = "Lo siento, estoy teniendo problemas técnicos. Intenta de nuevo en unos minutos."
    max_messages_per_hour = 1000
    provider = "evolution"
    credentials = {"anthropic_api_key": "sk-fake-test"}
    webhook_secret = ""
    schedule = ""
    timezone = "Atlantic/Canary"
    reservations_closed_for: list[str] = []
    tone = "friendly"
    business_description = ""
    payment_methods: list[str] = []
    accept_online_payment = False
    drinks_greeting_pitch = ""


def _resp(blocks: list, *, stop_reason: str = "end_turn", in_t: int = 100, out_t: int = 0):
    """Construye un objeto tipo Anthropic Response con .content + .usage + .stop_reason."""
    return SimpleNamespace(
        content=blocks,
        stop_reason=stop_reason,
        usage=SimpleNamespace(input_tokens=in_t, output_tokens=out_t),
    )


def _text_block(text: str):
    return SimpleNamespace(type="text", text=text)


# Mocks externos comunes a todos los tests
def _common_patches():
    return [
        patch.object(brain, "obtener_anthropic_api_key", new=AsyncMock(return_value="sk-fake-test")),
        patch.object(brain, "obtener_contexto_cliente", new=AsyncMock(return_value=None)),
        patch.object(brain, "_render_contexto_cliente", return_value=None),
        patch.object(brain, "obtener_pedido_pendiente_eta", new=AsyncMock(return_value=None)),
    ]


# ─────────────────────────────────────────────────────────────────────
# 1) ESTRUCTURAL — el código contiene la lógica de retry y el mensaje
#    contextual sin "problemas técnicos".
# ─────────────────────────────────────────────────────────────────────


def test_codigo_brain_tiene_retry_en_caso_content_vacio() -> None:
    """El source de generar_respuesta debe contener una rama explícita
    de retry cuando Claude devuelve content vacío. Si esto desaparece
    en un refactor el bug Fabian vuelve."""
    src = inspect.getsource(brain.generar_respuesta)
    # Marcador del intento adicional. Cualquiera de estos basta — buscamos
    # señal explícita de que existe un 2º intento, no solo 1.
    markers = ["empty_content_retry", "retry_empty", "_retry_count", "empty_attempt"]
    assert any(m in src for m in markers), (
        f"generar_respuesta debe tener un retry explícito ante content=[]. "
        f"Buscando marcadores: {markers}"
    )


def test_codigo_brain_no_devuelve_error_message_directamente_en_empty_content() -> None:
    """En la rama de content vacío, antes de devolver tenant.error_message
    debe haber un retry o un mensaje contextual. El return crudo a
    error_message en empty path es el bug."""
    src = inspect.getsource(brain.generar_respuesta)
    # Tomamos el bloque alrededor de brain_empty_text. Si en ese bloque
    # el primer return es tenant.error_message sin retry intermedio, falla.
    idx = src.find("brain_empty_text")
    assert idx > -1, "evento brain_empty_text debe seguir existiendo"
    sub = src[idx:idx + 3000]  # bloque suficientemente amplio
    # Debe aparecer alguna señal de retry/contextual antes del próximo return.
    has_retry_signal = any(
        s in sub for s in ["retry", "intento adicional", "second attempt", "reintentar"]
    )
    has_contextual_msg = any(
        s in sub for s in ["EMPTY_CONTEXTUAL", "no he podido procesar", "_empty_contextual_msg"]
    )
    assert has_retry_signal or has_contextual_msg, (
        "Tras brain_empty_text debe haber retry o mensaje contextual "
        "ANTES de caer en tenant.error_message."
    )


# ─────────────────────────────────────────────────────────────────────
# 2) BEHAVIORAL — mock client.messages.create
# ─────────────────────────────────────────────────────────────────────


def test_empty_content_dispara_retry_y_devuelve_la_2a_si_es_buena() -> None:
    """1ª llamada Claude → content=[]. 2ª → "Genial Fabian!".
    El brain debe hacer 2 llamadas (retry) y devolver el texto bueno.
    """

    fake = AsyncMock()
    # 1ª: vacía. 2ª: respuesta normal.
    fake.messages.create = AsyncMock(side_effect=[
        _resp([], stop_reason="end_turn", out_t=0),
        _resp([_text_block("Genial Fabian, ¿qué te pongo?")], stop_reason="end_turn", out_t=15),
    ])

    patches = _common_patches() + [patch.object(brain, "_get_client", return_value=fake)]
    for p in patches: p.start()
    try:
        respuesta, _, _ = asyncio.run(brain.generar_respuesta(
            _Tenant(),  # type: ignore[arg-type]
            "Fabian",
            historial=[
                {"role": "user", "content": "Hola"},
                {"role": "assistant", "content": "¿A qué nombre?"},
            ],
            customer_phone="playground-sandbox",  # anonymous → no handoff
            sandbox=True,
        ))
    finally:
        for p in patches: p.stop()

    # 2 llamadas a Claude (retry funcionó)
    assert fake.messages.create.await_count == 2, (
        f"Esperado 2 llamadas (1 vacía + 1 retry). Got {fake.messages.create.await_count}"
    )
    # Devuelve el texto de la 2ª llamada
    assert respuesta == "Genial Fabian, ¿qué te pongo?"
    assert "problemas técnicos" not in respuesta.lower()


def test_empty_content_2x_consecutivas_devuelve_mensaje_contextual_no_problemas_tecnicos() -> None:
    """Las 2 llamadas devuelven content=[]. El cliente debe leer un
    mensaje CONTEXTUAL ("¿puedes repetirlo?"), nunca "problemas técnicos"."""

    fake = AsyncMock()
    fake.messages.create = AsyncMock(side_effect=[
        _resp([], stop_reason="end_turn", out_t=0),
        _resp([], stop_reason="end_turn", out_t=0),
    ])

    patches = _common_patches() + [patch.object(brain, "_get_client", return_value=fake)]
    for p in patches: p.start()
    try:
        respuesta, _, _ = asyncio.run(brain.generar_respuesta(
            _Tenant(),  # type: ignore[arg-type]
            "Fabian",
            historial=[],
            customer_phone="playground-sandbox",
            sandbox=True,
        ))
    finally:
        for p in patches: p.stop()

    assert fake.messages.create.await_count == 2, (
        f"Debe intentar 2 veces antes de rendirse. Got {fake.messages.create.await_count}"
    )
    # NO debe ser el error_message agresivo del tenant
    assert "problemas técnicos" not in respuesta.lower(), (
        f"PROHIBIDO devolver 'problemas técnicos'. Got: {respuesta!r}"
    )
    # Debe ser un mensaje que pide repetir, no un fail genérico
    pide_repetir = any(s in respuesta.lower() for s in [
        "repetir", "repetirlo", "repítemelo", "puedes decir", "no he podido procesar",
        "could you repeat", "wiederholen", "ripetere", "répéter", "repetir",
    ])
    assert pide_repetir, (
        f"El mensaje contextual debe pedir repetir el último mensaje. Got: {respuesta!r}"
    )


def test_empty_content_2x_aun_dispara_auto_handoff_para_phone_real() -> None:
    """Cuando el cliente NO es anónimo, además del mensaje contextual
    el sistema debe seguir creando handoff_request para que el admin
    tome la conversación. Esa cadena ya funciona y NO se debe romper."""

    fake = AsyncMock()
    fake.messages.create = AsyncMock(side_effect=[
        _resp([], stop_reason="end_turn", out_t=0),
        _resp([], stop_reason="end_turn", out_t=0),
    ])

    handoff_mock = AsyncMock()
    audit_mock = AsyncMock()
    patches = _common_patches() + [
        patch.object(brain, "_get_client", return_value=fake),
        patch.object(brain, "crear_handoff", new=handoff_mock),
        patch.object(brain, "_registrar_alerta_empty_unrecoverable", new=audit_mock),
    ]
    for p in patches: p.start()
    try:
        respuesta, _, _ = asyncio.run(brain.generar_respuesta(
            _Tenant(),  # type: ignore[arg-type]
            "Fabian",
            historial=[],
            customer_phone="+34625000000",   # phone REAL → handoff sí
            sandbox=False,
        ))
    finally:
        for p in patches: p.stop()

    assert handoff_mock.await_count == 1, (
        f"Phone real con 2 vacíos seguidos debe crear handoff. Got {handoff_mock.await_count}"
    )
    # Acción audit-prod #3: alerta proactiva en audit_log para super admin.
    assert audit_mock.await_count == 1, (
        f"Phone real con 2 vacíos seguidos debe insertar audit_log alert. Got {audit_mock.await_count}"
    )
    assert "problemas técnicos" not in respuesta.lower()


def test_empty_content_2x_anonymous_NO_dispara_audit_log() -> None:
    """En sesiones anónimas (playground-sandbox / widget público) NO debe
    insertarse audit_log alert — son tests del owner, no incidentes reales."""

    fake = AsyncMock()
    fake.messages.create = AsyncMock(side_effect=[
        _resp([], stop_reason="end_turn", out_t=0),
        _resp([], stop_reason="end_turn", out_t=0),
    ])

    handoff_mock = AsyncMock()
    audit_mock = AsyncMock()
    patches = _common_patches() + [
        patch.object(brain, "_get_client", return_value=fake),
        patch.object(brain, "crear_handoff", new=handoff_mock),
        patch.object(brain, "_registrar_alerta_empty_unrecoverable", new=audit_mock),
    ]
    for p in patches: p.start()
    try:
        respuesta, _, _ = asyncio.run(brain.generar_respuesta(
            _Tenant(),  # type: ignore[arg-type]
            "test",
            historial=[],
            customer_phone="playground-sandbox",
            sandbox=True,
        ))
    finally:
        for p in patches: p.stop()

    assert handoff_mock.await_count == 0, "anonymous NO debe crear handoff"
    assert audit_mock.await_count == 0, "anonymous NO debe insertar audit_log alert"
    assert "problemas técnicos" not in respuesta.lower()


def test_respuesta_buena_a_la_primera_no_dispara_retry() -> None:
    """Sanity check: cuando Claude responde bien la 1ª vez, NO debe haber
    una 2ª llamada (no malgastar tokens en runs OK)."""

    fake = AsyncMock()
    fake.messages.create = AsyncMock(return_value=_resp(
        [_text_block("¡Hola buenas! ¿En qué te puedo ayudar?")],
        stop_reason="end_turn", out_t=20,
    ))

    patches = _common_patches() + [patch.object(brain, "_get_client", return_value=fake)]
    for p in patches: p.start()
    try:
        respuesta, _, _ = asyncio.run(brain.generar_respuesta(
            _Tenant(),  # type: ignore[arg-type]
            "Hola",
            historial=[],
            customer_phone="playground-sandbox",
            sandbox=True,
        ))
    finally:
        for p in patches: p.stop()

    assert fake.messages.create.await_count == 1
    assert respuesta == "¡Hola buenas! ¿En qué te puedo ayudar?"
