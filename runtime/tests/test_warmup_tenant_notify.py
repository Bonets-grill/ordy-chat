"""Regresión del aviso de warmup cap al tenant humano.

Cambio 2026-04-20 (raíz P0 Bonets Grill):
  El cliente final recibía "He llegado al límite de mensajes por hoy"
  cuando el bot alcanzaba el cap diario del warmup. Eso:
    - Erosionaba confianza (parece bot roto).
    - Exponía detalle técnico que no aporta al cliente.
    - Dejaba al humano del tenant sin saber que tenía que atender manual.

  Ahora silencio total al cliente + 1 notificación/día al
  handoff_whatsapp_phone del tenant.

Estos tests cementan:
  1. Sin handoff_whatsapp_phone configurado → no hace nada.
  2. Con handoff → manda UNA vez al día al humano.
  3. Segunda llamada mismo día mismo tenant → no reenvía (dedupe).
  4. Tenant distinto → sí envía.
"""

from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import UUID

import pytest

from app import main as main_mod


def _fake_tenant(tenant_id: str, name: str = "Bonets Grill"):
    return SimpleNamespace(id=UUID(tenant_id), name=name, slug="bonets-grill-icod")


class _FakeConn:
    def __init__(self, target_phone: str | None):
        self._target = target_phone

    async def fetchval(self, _sql: str, _tenant_id):
        return self._target


class _FakePoolCtx:
    def __init__(self, target_phone: str | None):
        self._target = target_phone

    async def __aenter__(self):
        return _FakeConn(self._target)

    async def __aexit__(self, *a):
        return None


class _FakePool:
    def __init__(self, target_phone: str | None):
        self._target = target_phone

    def acquire(self):
        return _FakePoolCtx(self._target)


@pytest.fixture(autouse=True)
def _reset_dedupe_cache():
    main_mod._warmup_notify_cache.clear()
    yield
    main_mod._warmup_notify_cache.clear()


@pytest.mark.asyncio
async def test_sin_handoff_phone_no_envia() -> None:
    adapter = SimpleNamespace(enviar_mensaje=AsyncMock())
    tenant = _fake_tenant("00000000-0000-0000-0000-000000000001")
    with patch.object(main_mod, "inicializar_pool", AsyncMock(return_value=_FakePool(None))):
        await main_mod._notificar_tenant_warmup_cap(
            tenant, adapter, {"tier": "fresh", "cap": 30, "sent_today": 31},
        )
    assert adapter.enviar_mensaje.await_count == 0


@pytest.mark.asyncio
async def test_envia_una_vez_al_humano_con_handoff() -> None:
    adapter = SimpleNamespace(enviar_mensaje=AsyncMock())
    tenant = _fake_tenant("00000000-0000-0000-0000-000000000002")
    with patch.object(main_mod, "inicializar_pool", AsyncMock(return_value=_FakePool("+34604000000"))):
        await main_mod._notificar_tenant_warmup_cap(
            tenant, adapter, {"tier": "early", "cap": 100, "sent_today": 101},
        )
    assert adapter.enviar_mensaje.await_count == 1
    target, body = adapter.enviar_mensaje.call_args.args
    assert target == "+34604000000"
    assert "Warmup cap alcanzado" in body
    assert "Bonets Grill" in body
    assert "tier early" in body
    assert "101/100" in body


@pytest.mark.asyncio
async def test_dedupe_mismo_dia_no_reenvia() -> None:
    adapter = SimpleNamespace(enviar_mensaje=AsyncMock())
    tenant = _fake_tenant("00000000-0000-0000-0000-000000000003")
    with patch.object(main_mod, "inicializar_pool", AsyncMock(return_value=_FakePool("+34604111111"))):
        await main_mod._notificar_tenant_warmup_cap(
            tenant, adapter, {"tier": "fresh", "cap": 30, "sent_today": 31},
        )
        await main_mod._notificar_tenant_warmup_cap(
            tenant, adapter, {"tier": "fresh", "cap": 30, "sent_today": 32},
        )
    assert adapter.enviar_mensaje.await_count == 1, "dedup mismo día debe bloquear la 2ª llamada"


@pytest.mark.asyncio
async def test_tenant_distinto_si_envia() -> None:
    adapter = SimpleNamespace(enviar_mensaje=AsyncMock())
    t1 = _fake_tenant("00000000-0000-0000-0000-000000000004", "Tenant A")
    t2 = _fake_tenant("00000000-0000-0000-0000-000000000005", "Tenant B")
    with patch.object(main_mod, "inicializar_pool", AsyncMock(return_value=_FakePool("+34604222222"))):
        await main_mod._notificar_tenant_warmup_cap(
            t1, adapter, {"tier": "mid", "cap": 300, "sent_today": 301},
        )
        await main_mod._notificar_tenant_warmup_cap(
            t2, adapter, {"tier": "fresh", "cap": 30, "sent_today": 31},
        )
    assert adapter.enviar_mensaje.await_count == 2


@pytest.mark.asyncio
async def test_adapter_falla_no_levanta() -> None:
    adapter = SimpleNamespace(enviar_mensaje=AsyncMock(side_effect=RuntimeError("WA down")))
    tenant = _fake_tenant("00000000-0000-0000-0000-000000000006")
    with patch.object(main_mod, "inicializar_pool", AsyncMock(return_value=_FakePool("+34604333333"))):
        # No debe propagar — el aviso es best-effort.
        await main_mod._notificar_tenant_warmup_cap(
            tenant, adapter, {"tier": "fresh", "cap": 30, "sent_today": 31},
        )
    assert adapter.enviar_mensaje.await_count == 1
