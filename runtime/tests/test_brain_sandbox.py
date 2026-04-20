"""Regresión del modo sandbox del brain.

Bug (2026-04-20):
  El playground (`customer_phone="playground-sandbox"`) y el validator
  (`customer_phone="+00000VALIDATOR"`) ejecutaban tools con side-effects
  reales. Cada run del validator creaba filas reales en `handoff_requests`
  cuando Claude elegía `solicitar_humano`, y el playground también
  disparaba notificaciones WA al humano del tenant.

  Resultado en prod: 47 filas fantasma en `handoff_requests` y riesgo de
  spammear al dueño del negocio desde el playground.

Fix: `brain.generar_respuesta(..., sandbox=True)` propaga al
`_ejecutar_tool(..., sandbox=True)`, que corto-circuita a stubs JSON
ANTES del bloque oportunista de `actualizar_nombre_cliente` y antes
de invocar `crear_handoff`/`crear_pedido`/`crear_cita`.

Estos tests cementan que:
  1. En sandbox ningún side-effect (crear_handoff, crear_pedido,
     crear_cita, actualizar_nombre_cliente) se invoca.
  2. El stub devuelve JSON plausible con `"sandbox": true`.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch
from uuid import UUID

import pytest

from app import brain


class _FakeTenant:
    id = UUID("00000000-0000-0000-0000-000000000001")
    slug = "fake-tenant"


@pytest.mark.asyncio
async def test_sandbox_solicitar_humano_no_llama_crear_handoff() -> None:
    with patch.object(brain, "crear_handoff", new=AsyncMock()) as m_handoff, \
         patch.object(brain, "actualizar_nombre_cliente", new=AsyncMock()) as m_name:
        raw = await brain._ejecutar_tool(
            _FakeTenant(),  # type: ignore[arg-type]
            "solicitar_humano",
            {"reason": "cliente enfadado", "priority": "urgent", "customer_name": "Juan"},
            customer_phone="+00000VALIDATOR",
            sandbox=True,
        )

    assert m_handoff.await_count == 0, "crear_handoff NO debe invocarse en sandbox"
    assert m_name.await_count == 0, "actualizar_nombre_cliente NO debe invocarse en sandbox"

    parsed = json.loads(raw)
    assert parsed["ok"] is True
    assert parsed["sandbox"] is True
    assert parsed["handoff_id"].startswith("sandbox-")
    assert parsed["notified_human_phone"] is False
    assert parsed["priority"] == "urgent"
    assert parsed["reason"] == "cliente enfadado"


@pytest.mark.asyncio
async def test_sandbox_crear_pedido_no_llama_ordering() -> None:
    with patch.object(brain, "crear_pedido", new=AsyncMock()) as m_pedido, \
         patch.object(brain, "obtener_link_pago", new=AsyncMock()) as m_link, \
         patch.object(brain, "actualizar_nombre_cliente", new=AsyncMock()) as m_name:
        raw = await brain._ejecutar_tool(
            _FakeTenant(),  # type: ignore[arg-type]
            "crear_pedido",
            {"items": [{"sku": "X", "qty": 1}], "customer_name": "Ana"},
            customer_phone="playground-sandbox",
            sandbox=True,
        )

    assert m_pedido.await_count == 0
    assert m_link.await_count == 0
    assert m_name.await_count == 0

    parsed = json.loads(raw)
    assert parsed["ok"] is True
    assert parsed["sandbox"] is True
    assert parsed["order_id"].startswith("sandbox-")
    assert parsed["payment_mode"] == "offline"


@pytest.mark.asyncio
async def test_sandbox_agendar_cita_no_llama_crear_cita() -> None:
    with patch.object(brain, "crear_cita", new=AsyncMock()) as m_cita, \
         patch.object(brain, "actualizar_nombre_cliente", new=AsyncMock()) as m_name:
        raw = await brain._ejecutar_tool(
            _FakeTenant(),  # type: ignore[arg-type]
            "agendar_cita",
            {
                "starts_at_iso": "2099-01-01T10:00:00+00:00",
                "title": "Consulta",
                "duration_min": 45,
            },
            customer_phone="+00000VALIDATOR",
            sandbox=True,
        )

    assert m_cita.await_count == 0
    assert m_name.await_count == 0

    parsed = json.loads(raw)
    assert parsed["ok"] is True
    assert parsed["sandbox"] is True
    assert parsed["appointment_id"].startswith("sandbox-")
    assert parsed["duration_min"] == 45


@pytest.mark.asyncio
async def test_sandbox_recordar_cliente_no_persiste_nombre() -> None:
    with patch.object(brain, "actualizar_nombre_cliente", new=AsyncMock()) as m_name:
        raw = await brain._ejecutar_tool(
            _FakeTenant(),  # type: ignore[arg-type]
            "recordar_cliente",
            {"customer_name": "Mario Canarias", "nombre": "Mario"},
            customer_phone="playground-sandbox",
            sandbox=True,
        )

    assert m_name.await_count == 0, (
        "En sandbox actualizar_nombre_cliente NO debe correr — contamina "
        "conversations con customer_phone ficticio"
    )
    parsed = json.loads(raw)
    assert parsed["ok"] is True
    assert parsed["sandbox"] is True


@pytest.mark.asyncio
async def test_sandbox_mis_citas_no_toca_db() -> None:
    with patch.object(brain, "listar_citas_del_cliente", new=AsyncMock()) as m_list:
        raw = await brain._ejecutar_tool(
            _FakeTenant(),  # type: ignore[arg-type]
            "mis_citas",
            {"limit": 5},
            customer_phone="playground-sandbox",
            sandbox=True,
        )

    assert m_list.await_count == 0
    parsed = json.loads(raw)
    assert parsed["ok"] is True
    assert parsed["sandbox"] is True
    assert parsed["count"] == 0
    assert parsed["citas"] == []


def test_sandbox_tool_stub_desconocida_devuelve_error_con_flag() -> None:
    raw = brain._sandbox_tool_stub("tool_que_no_existe", {})
    parsed = json.loads(raw)
    assert parsed["ok"] is False
    assert parsed["sandbox"] is True
    assert "tool_que_no_existe" in parsed["error"]
