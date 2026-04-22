"""Regresión del modo sandbox del brain tras mig 029.

Historia:
  - Antes (20-abr): sandbox devolvía stubs JSON, no persistía NADA. Imposible
    validar end-to-end desde el playground (pedidos/reservas/conversaciones
    no aparecían en los dashboards).
  - 21-abr PR #29: solicitar_humano pasó a ejecutar real con sandbox=True
    (prefijo "[PLAYGROUND]" en reason + "🧪 PRUEBA PLAYGROUND" en WA body).
  - 22-abr mig 029: el resto de tools también ejecuta real, pasando
    is_test=True. Las filas persisten marcadas; los dashboards las filtran
    por defecto con un toggle "🧪 Incluir pruebas".

Estos tests cementan que en sandbox cada tool invoca su función REAL con
is_test=True (o sandbox=True en el caso de crear_handoff), en vez de
stubbear.
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
    reservations_closed_for: list[str] = []
    timezone = "Europe/Madrid"


@pytest.mark.asyncio
async def test_sandbox_solicitar_humano_llama_crear_handoff_con_flag() -> None:
    """solicitar_humano en sandbox → crear_handoff(..., sandbox=True)."""
    fake_result = {
        "ok": True,
        "handoff_id": "real-uuid-abc123",
        "priority": "urgent",
        "reason": "cliente enfadado",
        "notified_human_phone": True,
        "is_test": True,
    }
    with patch.object(brain, "crear_handoff", new=AsyncMock(return_value=fake_result)) as m_handoff:
        raw = await brain._ejecutar_tool(
            _FakeTenant(),  # type: ignore[arg-type]
            "solicitar_humano",
            {"reason": "cliente enfadado", "priority": "urgent", "customer_name": "Juan"},
            customer_phone="playground-sandbox",
            sandbox=True,
        )

    assert m_handoff.await_count == 1
    _, kwargs = m_handoff.call_args
    assert kwargs.get("sandbox") is True, "crear_handoff debe recibir sandbox=True"
    assert kwargs.get("reason") == "cliente enfadado"
    assert kwargs.get("priority") == "urgent"

    parsed = json.loads(raw)
    assert parsed["ok"] is True
    assert parsed["handoff_id"] == "real-uuid-abc123"


@pytest.mark.asyncio
async def test_sandbox_crear_pedido_ejecuta_real_con_is_test() -> None:
    """crear_pedido en sandbox → llama la función real con is_test=True."""
    fake_order = {"orderId": "real-order-999", "totalCents": 1490, "currency": "EUR"}
    with patch.object(brain, "crear_pedido", new=AsyncMock(return_value=fake_order)) as m_pedido, \
         patch.object(brain, "actualizar_nombre_cliente", new=AsyncMock()) as m_name:
        raw = await brain._ejecutar_tool(
            _FakeTenant(),  # type: ignore[arg-type]
            "crear_pedido",
            {
                "items": [{"name": "Burger", "quantity": 1, "unit_price_cents": 1490}],
                "customer_name": "Ana",
                "order_type": "takeaway",
            },
            customer_phone="playground-sandbox",
            sandbox=True,
        )

    assert m_pedido.await_count == 1, "sandbox ya no stubbea — debe llamar crear_pedido real"
    _, kwargs = m_pedido.call_args
    assert kwargs.get("is_test") is True, "mig 029: crear_pedido recibe is_test=True en sandbox"
    # El nombre oportunista SÍ se guarda en sandbox (marcado is_test).
    assert m_name.await_count == 1
    _, name_kwargs = m_name.call_args
    assert name_kwargs.get("is_test") is True

    parsed = json.loads(raw)
    assert parsed["ok"] is True
    assert parsed["order_id"] == "real-order-999"


@pytest.mark.asyncio
async def test_sandbox_agendar_cita_ejecuta_real_con_is_test() -> None:
    """agendar_cita en sandbox → crear_cita(..., is_test=True)."""
    fake_result = {"ok": True, "appointment_id": "real-app-123", "starts_at_iso": "2099-01-01T10:00:00+00:00", "duration_min": 45, "title": "Consulta", "is_test": True}
    with patch.object(brain, "crear_cita", new=AsyncMock(return_value=fake_result)) as m_cita:
        raw = await brain._ejecutar_tool(
            _FakeTenant(),  # type: ignore[arg-type]
            "agendar_cita",
            {
                "starts_at_iso": "2099-01-01T10:00:00+00:00",
                "title": "Consulta",
                "duration_min": 45,
            },
            customer_phone="playground-sandbox",
            sandbox=True,
        )

    assert m_cita.await_count == 1
    _, kwargs = m_cita.call_args
    assert kwargs.get("is_test") is True, "mig 029: crear_cita recibe is_test=True en sandbox"

    parsed = json.loads(raw)
    assert parsed["ok"] is True
    assert parsed["appointment_id"] == "real-app-123"


@pytest.mark.asyncio
async def test_sandbox_recordar_cliente_persiste_con_is_test() -> None:
    """recordar_cliente en sandbox → actualizar_nombre_cliente(..., is_test=True)."""
    with patch.object(brain, "actualizar_nombre_cliente", new=AsyncMock()) as m_name:
        raw = await brain._ejecutar_tool(
            _FakeTenant(),  # type: ignore[arg-type]
            "recordar_cliente",
            {"customer_name": "Mario Canarias", "nombre": "Mario"},
            customer_phone="playground-sandbox",
            sandbox=True,
        )

    assert m_name.await_count == 1, (
        "mig 029: ya NO saltamos actualizar_nombre_cliente en sandbox — "
        "persistimos la conversación con is_test=true para que aparezca "
        "en /dashboard/conversations con el toggle 'Incluir pruebas'."
    )
    _, kwargs = m_name.call_args
    assert kwargs.get("is_test") is True

    parsed = json.loads(raw)
    assert parsed["ok"] is True
    assert parsed["is_test"] is True


@pytest.mark.asyncio
async def test_sandbox_mis_citas_ejecuta_real() -> None:
    """mis_citas es read-only → corre real en sandbox (sin flag)."""
    fake_citas = [{"id": "app-1", "starts_at_iso": "2099-01-01T10:00:00+00:00", "duration_min": 30, "title": "X", "status": "pending"}]
    with patch.object(brain, "listar_citas_del_cliente", new=AsyncMock(return_value=fake_citas)) as m_list:
        raw = await brain._ejecutar_tool(
            _FakeTenant(),  # type: ignore[arg-type]
            "mis_citas",
            {"limit": 5},
            customer_phone="playground-sandbox",
            sandbox=True,
        )

    assert m_list.await_count == 1, "mis_citas es read-only, debe ejecutarse también en sandbox"
    parsed = json.loads(raw)
    assert parsed["ok"] is True
    assert parsed["count"] == 1


def test_sandbox_tool_stub_fue_eliminado() -> None:
    """Guard: _sandbox_tool_stub se eliminó en mig 029. Si alguien lo
    reintroduce, este test falla para recordar que la política cambió a
    'ejecuta real con is_test=True' en vez de stubs."""
    assert not hasattr(brain, "_sandbox_tool_stub"), (
        "mig 029: _sandbox_tool_stub fue eliminado. Sandbox ejecuta tools "
        "reales con is_test=True. No reintroducir stubs."
    )
