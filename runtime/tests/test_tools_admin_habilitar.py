"""Regresión del matcher de habilitar_item + audit_log central.

Bugs cerrados 2026-04-20 (auditoría):
  P1: habilitar_item usaba LOWER exact → "Dakota" no matcheaba
      "Dakota burger" → tool ok=false → LLM respondía "✓ habilitada"
      mintiendo. Fix: fuzzy ILIKE fallback + prompt que prohibe ✓ con
      ok=false.
  P2: _MUTATIVE_TOOLS no escribía a audit_log. Fix: _log_audit en el
      dispatcher central.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.tools_admin import (
    _MUTATIVE_TOOLS,
    _h_habilitar_item,
    ejecutar_tool_admin,
)


def _mk_conn(
    *,
    fetchrow: list | None = None,
    fetch: list | None = None,
    execute_return: str = "DELETE 1",
):
    """Conn mock con respuestas programadas para las queries de habilitar."""
    conn = MagicMock()
    conn.fetchrow = AsyncMock(side_effect=fetchrow if fetchrow is not None else [])
    conn.fetch = AsyncMock(side_effect=fetch if fetch is not None else [])
    conn.execute = AsyncMock(return_value=execute_return)
    return conn


@pytest.mark.asyncio
async def test_habilitar_exact_match_borra_y_ok() -> None:
    conn = _mk_conn(
        fetchrow=[{"item_name": "Dakota burger"}],  # exact match
    )
    result = await _h_habilitar_item(
        conn, uuid4(), {"item_name": "Dakota burger"}, admin_id=uuid4()
    )
    assert result["ok"] is True
    assert result["item"] == "Dakota burger"
    assert result["match"] == "exact"
    conn.execute.assert_awaited_once()


@pytest.mark.asyncio
async def test_habilitar_fuzzy_unico_match_usa_canonico() -> None:
    """Usuario dice 'Dakota', DB tiene 'Dakota burger' — fuzzy devuelve 1,
    se borra y el tool retorna el nombre canónico al LLM."""
    conn = _mk_conn(
        fetchrow=[None],                              # 0 exact
        fetch=[[{"item_name": "Dakota burger"}]],     # 1 fuzzy
    )
    result = await _h_habilitar_item(
        conn, uuid4(), {"item_name": "Dakota"}, admin_id=uuid4()
    )
    assert result["ok"] is True
    assert result["item"] == "Dakota burger"
    assert result["match"] == "fuzzy"
    assert result["query"] == "Dakota"
    conn.execute.assert_awaited_once()


@pytest.mark.asyncio
async def test_habilitar_fuzzy_multiple_no_borra_lista_candidatos() -> None:
    conn = _mk_conn(
        fetchrow=[None],
        fetch=[[
            {"item_name": "Dakota burger"},
            {"item_name": "Dakota XL"},
        ]],
    )
    result = await _h_habilitar_item(
        conn, uuid4(), {"item_name": "Dakota"}, admin_id=uuid4()
    )
    assert result["ok"] is False
    assert "Dakota burger" in result["error"]
    assert "Dakota XL" in result["error"]
    # No debe borrar cuando hay ambigüedad.
    conn.execute.assert_not_awaited()


@pytest.mark.asyncio
async def test_habilitar_sin_matches_devuelve_ok_false() -> None:
    conn = _mk_conn(fetchrow=[None], fetch=[[]])
    result = await _h_habilitar_item(
        conn, uuid4(), {"item_name": "Algo que no existe"}, admin_id=uuid4()
    )
    assert result["ok"] is False
    assert "no estaba deshabilitado" in result["error"]
    conn.execute.assert_not_awaited()


@pytest.mark.asyncio
async def test_habilitar_item_vacio_rechaza_temprano() -> None:
    conn = _mk_conn()
    result = await _h_habilitar_item(
        conn, uuid4(), {"item_name": "   "}, admin_id=uuid4()
    )
    assert result["ok"] is False
    conn.fetchrow.assert_not_awaited()


# ── P2: audit_log ──────────────────────────────────────────


def _mk_pool(conn):
    @asynccontextmanager
    async def _acquire():
        yield conn
    pool = MagicMock()
    pool.acquire = lambda: _acquire()
    return pool


@pytest.mark.asyncio
async def test_ejecutar_tool_mutative_escribe_audit_log(monkeypatch) -> None:
    """Cada tool en _MUTATIVE_TOOLS debe escribir 1 fila a audit_log tras
    ejecutar (incluso si ok=false). Bug P2 pre-fix: audit_log quedaba vacío."""
    conn = _mk_conn(fetchrow=[None], fetch=[[]])  # habilitar → ok=false
    tenant_id = uuid4()
    admin_id = uuid4()

    pool = _mk_pool(conn)
    result = await ejecutar_tool_admin(
        pool, tenant_id, "habilitar_item", {"item_name": "X"}, admin_id
    )
    assert result["ok"] is False

    # Debe haber 1 execute con INSERT INTO audit_log.
    audit_calls = [c for c in conn.execute.call_args_list if "audit_log" in str(c)]
    assert len(audit_calls) == 1, f"expected 1 audit_log INSERT, got {len(audit_calls)}"
    call_str = str(audit_calls[0])
    assert "admin_tool:habilitar_item" in call_str
    assert str(tenant_id) in call_str


@pytest.mark.asyncio
async def test_ejecutar_tool_read_only_NO_escribe_audit_log() -> None:
    """listar_items_deshabilitados no está en _MUTATIVE_TOOLS → no hay fila."""
    conn = _mk_conn(fetch=[[]])  # fetch vacío
    pool = _mk_pool(conn)
    await ejecutar_tool_admin(pool, uuid4(), "listar_items_deshabilitados", {})
    audit_calls = [c for c in conn.execute.call_args_list if "audit_log" in str(c)]
    assert audit_calls == []


def test_mutative_set_cubre_tools_destructivas() -> None:
    """Blindaje: si alguien añade una tool destructiva nueva, tiene que
    recordar meterla en _MUTATIVE_TOOLS explícitamente."""
    destructivas_esperadas = {
        "deshabilitar_item",
        "habilitar_item",
        "cambiar_horario",
        "pausar_bot",
        "reanudar_bot",
        "cancelar_reserva",
        "cerrar_reservas_dia",
        "pausar_conversacion",
        "reanudar_conversacion",
        "agregar_faq",
    }
    assert _MUTATIVE_TOOLS == destructivas_esperadas
