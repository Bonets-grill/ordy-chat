"""Regresión: tool modificar_pedido evita pedidos duplicados en el KDS.

Bug (22-abr 15:23, reportado por Mario):
  Cliente hizo un pedido → bot llamó crear_pedido y creó order #1.
  Cliente escribió "quita la cebolla de la Dakota" → bot llamó crear_pedido
  OTRA VEZ con el pedido entero + la modificación. Resultado: 2 cards en KDS
  para el mismo cliente.

Fix:
  - Nueva tool modificar_pedido: añade la modificación al pedido existente
    (orders.notes) si kitchen_decision aún está pending. Si ya aceptado →
    devuelve 'pedido_ya_en_preparacion' para que el bot se disculpe.
  - Hard rule 12 en prompt_wrapper.py: "NUNCA crear_pedido si ya hay un
    pedido del cliente en esta conversación — usa modificar_pedido".

Estructural — no invoca Claude ni toca DB real (mocks asyncpg).
"""

from __future__ import annotations

import inspect
import json
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

import pytest

from app import agent_tools, brain


def _modificar_tool() -> dict:
    return next(t for t in brain.TOOLS if t["name"] == "modificar_pedido")


def test_modificar_pedido_existe_en_tools() -> None:
    tool = _modificar_tool()
    schema = tool["input_schema"]
    assert schema.get("required") == ["change_request"]
    assert schema["properties"]["change_request"]["type"] == "string"
    desc = tool["description"].lower()
    assert "crear_pedido" in desc, "debe advertir contra llamar crear_pedido otra vez"
    assert "duplicado" in desc or "duplicad" in desc
    assert "pedido_ya_en_preparacion" in desc


def test_hard_rule_12_prohibe_duplicar_pedido() -> None:
    from app.prompt_wrapper import wrap
    wrapped = wrap("Negocio de prueba")
    low = wrapped.lower()
    assert "modificar_pedido" in low, "hard_rule 12 debe mencionar modificar_pedido"
    assert "duplicado" in low or "duplicad" in low, "hard_rule 12 debe advertir contra duplicados"


@pytest.mark.asyncio
async def test_modificar_pedido_devuelve_error_si_request_vacia() -> None:
    result = await agent_tools.modificar_pedido(
        tenant_id=UUID("00000000-0000-0000-0000-000000000001"),
        customer_phone="+34600000000",
        change_request="",
    )
    assert result["ok"] is False
    assert result["error"] == "request_vacia"


@pytest.mark.asyncio
async def test_modificar_pedido_devuelve_no_hay_pedido_cuando_no_existe() -> None:
    fake_conn = MagicMock()
    fake_conn.fetchrow = AsyncMock(return_value=None)
    fake_conn.execute = AsyncMock()
    pool = MagicMock()
    pool.acquire.return_value.__aenter__ = AsyncMock(return_value=fake_conn)
    pool.acquire.return_value.__aexit__ = AsyncMock(return_value=None)

    with patch.object(agent_tools, "inicializar_pool", new=AsyncMock(return_value=pool)):
        result = await agent_tools.modificar_pedido(
            tenant_id=UUID("00000000-0000-0000-0000-000000000001"),
            customer_phone="+34600000000",
            change_request="sin cebolla",
        )

    assert result["ok"] is False
    assert result["error"] == "no_hay_pedido"


@pytest.mark.asyncio
async def test_modificar_pedido_devuelve_ya_en_preparacion_si_cocina_aceptada() -> None:
    fake_row = {
        "id": UUID("11111111-1111-1111-1111-111111111111"),
        "status": "pending_kitchen_review",
        "kitchen_decision": "accepted",  # ← ya aceptado
        "notes": None,
    }
    fake_conn = MagicMock()
    fake_conn.fetchrow = AsyncMock(return_value=fake_row)
    fake_conn.execute = AsyncMock()
    pool = MagicMock()
    pool.acquire.return_value.__aenter__ = AsyncMock(return_value=fake_conn)
    pool.acquire.return_value.__aexit__ = AsyncMock(return_value=None)

    with patch.object(agent_tools, "inicializar_pool", new=AsyncMock(return_value=pool)):
        result = await agent_tools.modificar_pedido(
            tenant_id=UUID("00000000-0000-0000-0000-000000000001"),
            customer_phone="+34600000000",
            change_request="sin cebolla",
        )

    assert result["ok"] is False
    assert result["error"] == "pedido_ya_en_preparacion"
    # El hint debe guiar al bot a disculparse
    assert "disculp" in result["hint"].lower() or "preparaci" in result["hint"].lower()
    # NO debe haberse ejecutado el UPDATE
    assert fake_conn.execute.await_count == 0


@pytest.mark.asyncio
async def test_modificar_pedido_actualiza_notes_si_cocina_pendiente() -> None:
    order_uuid = UUID("11111111-1111-1111-1111-111111111111")
    fake_row = {
        "id": order_uuid,
        "status": "pending_kitchen_review",
        "kitchen_decision": "pending",
        "notes": None,
    }
    tenant_row = {
        "tenant_name": "Bonets Grill",
        "handoff_whatsapp_phone": None,
        "provider": "whapi",
        "credentials_encrypted": None,
    }
    fake_conn = MagicMock()
    # fetchrow se llama 2 veces: primero pedido, luego tenant info.
    fake_conn.fetchrow = AsyncMock(side_effect=[fake_row, tenant_row])
    fake_conn.execute = AsyncMock()
    pool = MagicMock()
    pool.acquire.return_value.__aenter__ = AsyncMock(return_value=fake_conn)
    pool.acquire.return_value.__aexit__ = AsyncMock(return_value=None)

    with patch.object(agent_tools, "inicializar_pool", new=AsyncMock(return_value=pool)):
        result = await agent_tools.modificar_pedido(
            tenant_id=UUID("00000000-0000-0000-0000-000000000001"),
            customer_phone="+34600000000",
            change_request="sin cebolla acaramelada en la Dakota",
            customer_name="Mario",
        )

    assert result["ok"] is True
    assert result["order_id"] == str(order_uuid)
    # El UPDATE se ejecutó con el note nuevo
    assert fake_conn.execute.await_count == 1
    args, _ = fake_conn.execute.call_args
    # args[0] = SQL, args[1] = order_id, args[2] = new_note
    assert args[1] == order_uuid
    assert "sin cebolla acaramelada" in args[2]
    assert "Mario" in args[2]
    assert "[MOD" in args[2]


@pytest.mark.asyncio
async def test_dispatch_sandbox_llama_modificar_pedido_con_is_test() -> None:
    """Desde brain._ejecutar_tool, sandbox=True → modificar_pedido(is_test=True)."""

    class _FakeTenant:
        id = UUID("00000000-0000-0000-0000-000000000001")
        slug = "fake"
        reservations_closed_for: list[str] = []
        timezone = "Europe/Madrid"

    fake_result = {"ok": True, "order_id": "abc", "is_test": True}
    with patch.object(brain, "modificar_pedido", new=AsyncMock(return_value=fake_result)) as m:
        raw = await brain._ejecutar_tool(
            _FakeTenant(),  # type: ignore[arg-type]
            "modificar_pedido",
            {"change_request": "sin cebolla", "customer_name": "Mario"},
            customer_phone="playground-sandbox",
            sandbox=True,
        )

    assert m.await_count == 1
    _, kwargs = m.call_args
    assert kwargs.get("is_test") is True
    assert kwargs.get("change_request") == "sin cebolla"
    parsed = json.loads(raw)
    assert parsed["ok"] is True


def test_modificar_pedido_tiene_is_test_param() -> None:
    """Guard estructural: la firma expone is_test para consistencia con mig 029."""
    sig = inspect.signature(agent_tools.modificar_pedido)
    assert "is_test" in sig.parameters
    assert sig.parameters["is_test"].default is False
