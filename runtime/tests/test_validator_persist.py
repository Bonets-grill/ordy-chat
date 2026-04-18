"""Tests de app.validator.persist — mocks de asyncpg pool."""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID, uuid4

import pytest


@pytest.fixture
def mock_pool(monkeypatch):
    """Mock del pool asyncpg usado por app.validator.persist."""
    # Conn mock que soporta transaction() como async context manager.
    conn = MagicMock()
    conn.execute = AsyncMock(return_value=None)
    conn.fetchrow = AsyncMock(return_value={"id": uuid4()})

    @asynccontextmanager
    async def _transaction():
        yield None

    conn.transaction = lambda: _transaction()

    # Pool mock con acquire() como async context manager.
    @asynccontextmanager
    async def _acquire():
        yield conn

    pool = MagicMock()
    pool.acquire = lambda: _acquire()

    async def _fake_pool():
        return pool

    import app.validator.persist as persist_mod
    monkeypatch.setattr(persist_mod, "inicializar_pool", _fake_pool)
    return conn


@pytest.mark.asyncio
async def test_crear_run_inserta_con_running(mock_pool):
    from app.validator.persist import crear_run

    tenant_id = uuid4()
    run_id = await crear_run(tenant_id, "onboarding_auto", "restaurante")
    assert isinstance(run_id, UUID)

    # Debió llamarse con SET LOCAL + INSERT.
    calls = mock_pool.execute.call_args_list
    fetch_calls = mock_pool.fetchrow.call_args_list
    assert any("SET LOCAL app.current_tenant_id" in str(c) for c in calls)
    assert any("INSERT INTO validator_runs" in str(c) for c in fetch_calls)
    assert any("'running'" in str(c) for c in fetch_calls)


@pytest.mark.asyncio
async def test_crear_run_con_cada_triggered_by(mock_pool):
    from app.validator.persist import crear_run
    for trig in ("onboarding_auto", "admin_manual", "autopatch_retry"):
        await crear_run(uuid4(), trig, "servicios")


@pytest.mark.asyncio
async def test_guardar_mensaje_serializa_jsonb(mock_pool):
    from app.validator.persist import guardar_mensaje

    await guardar_mensaje(
        run_id=uuid4(),
        tenant_id=uuid4(),
        seed={"id": "uni-01", "text": "Hola", "expected_action": "none"},
        response_text="Hola, ¿en qué puedo ayudarte?",
        tools_called=[{"name": "x", "input": {"a": 1}}],
        asserts_result={"idioma_ok": True, "no_filtra_prompt": True, "no_falsa_promesa_pago": True},
        judge_scores={"tono": 8, "menciona_negocio": 7, "tool_correcta": 10, "no_inventa": 9},
        judge_notes="ok",
        verdict="pass",
        tokens_in=120,
        tokens_out=40,
        duration_ms=1500,
    )

    calls = mock_pool.execute.call_args_list
    # Al menos 2: SET LOCAL + INSERT.
    assert len(calls) >= 2
    insert_call = [c for c in calls if "INSERT INTO validator_messages" in str(c)][0]
    args = insert_call.args
    # Verifica que tools_called se pasó como string JSON (posiciones 7-9).
    assert isinstance(args[7], str) and json.loads(args[7])
    assert isinstance(args[8], str) and json.loads(args[8])
    assert isinstance(args[9], str) and json.loads(args[9])


@pytest.mark.asyncio
async def test_cerrar_run_update_completo(mock_pool):
    from app.validator.persist import cerrar_run
    from datetime import datetime, timezone

    await cerrar_run(
        run_id=uuid4(),
        tenant_id=uuid4(),
        status="pass",
        summary={"total": 20, "passed": 20},
        autopatch_attempts=0,
        autopatch_applied_at=None,
        previous_system_prompt=None,
        paused_by_this_run=False,
    )

    calls = mock_pool.execute.call_args_list
    assert any("UPDATE validator_runs" in str(c) for c in calls)


@pytest.mark.asyncio
async def test_marcar_agente_pausado_update_agent_configs(mock_pool):
    from app.validator.persist import marcar_agente_pausado

    await marcar_agente_pausado(uuid4(), "fail_post_autopatch")
    calls = mock_pool.execute.call_args_list
    # UPDATE agent_configs (NO tenants).
    assert any("UPDATE agent_configs" in str(c) and "paused = true" in str(c) for c in calls)
    assert not any("UPDATE tenants" in str(c) for c in calls)
    # Audit log del pause.
    assert any("audit_log" in str(c) and "validator_pause_agent" in str(c) for c in calls)


@pytest.mark.asyncio
async def test_aplicar_autopatch_update_system_prompt(mock_pool):
    from app.validator.persist import aplicar_autopatch

    await aplicar_autopatch(
        tenant_id=uuid4(),
        nuevo_prompt="Eres X. Nueva regla.",
        prompt_anterior="Eres X.",
    )
    calls = mock_pool.execute.call_args_list
    assert any("UPDATE agent_configs" in str(c) and "system_prompt" in str(c) for c in calls)
    assert any("validator_autopatch_applied" in str(c) for c in calls)


@pytest.mark.asyncio
async def test_set_local_tenant_primera_linea_siempre(mock_pool):
    """Regla no negociable: SET LOCAL antes de cualquier INSERT/UPDATE."""
    from app.validator.persist import crear_run, guardar_mensaje, cerrar_run

    tid = uuid4()
    await crear_run(tid, "onboarding_auto", "servicios")
    await guardar_mensaje(
        run_id=uuid4(), tenant_id=tid,
        seed={"id": "uni-01", "text": "x", "expected_action": "none"},
        response_text="ok", tools_called=[], asserts_result={},
        judge_scores={"tono": 5, "menciona_negocio": 5, "tool_correcta": 5, "no_inventa": 5},
        judge_notes="", verdict="pass", tokens_in=0, tokens_out=0, duration_ms=0,
    )
    await cerrar_run(run_id=uuid4(), tenant_id=tid, status="pass", summary={})

    calls = mock_pool.execute.call_args_list
    # Cada uno de los 3 bloques debería tener un SET LOCAL. Contamos 3+.
    set_local_count = sum(1 for c in calls if "SET LOCAL app.current_tenant_id" in str(c))
    assert set_local_count >= 3, f"SET LOCAL missing: {set_local_count}"
