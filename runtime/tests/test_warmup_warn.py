"""Regresión del aviso temprano cap >= 80%.

Gap detectado tras el P0 de Bonets: el humano del tenant no sabía que
se acercaba al cap hasta que el bot ya se había silenciado. Ahora
cuando sent_today/cap >= 0.8 lanzamos un WhatsApp de aviso ANTES del
bloqueo, para dar margen a activar warmup_override o atender manual.

Contratos:
  1. Sin handoff_whatsapp_phone → no envía.
  2. ratio < 0.8 → no envía.
  3. ratio >= 0.8 con handoff → envía una vez con número cap/sent correctos.
  4. Dedup día+tenant: 2ª llamada mismo día no reenvía.
  5. cap=None (override/mature/no-evolution) → skip sin error.
  6. Caché independiente de la notificación de cap-hit: un tenant puede
     recibir AMBOS (aviso 80% + aviso cap hit) el mismo día.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import UUID

import pytest

from app import main as main_mod


def _fake_tenant(tid: str, name: str = "Bonets Grill"):
    return SimpleNamespace(id=UUID(tid), name=name, slug="bonets-grill-icod")


class _FakeConn:
    def __init__(self, target: str | None):
        self._target = target

    async def fetchval(self, _sql: str, _tid):
        return self._target


class _FakePoolCtx:
    def __init__(self, target: str | None):
        self._target = target

    async def __aenter__(self):
        return _FakeConn(self._target)

    async def __aexit__(self, *a):
        return None


class _FakePool:
    def __init__(self, target: str | None):
        self._target = target

    def acquire(self):
        return _FakePoolCtx(self._target)


@pytest.fixture(autouse=True)
def _reset_caches():
    main_mod._warmup_warn_cache.clear()
    main_mod._warmup_notify_cache.clear()
    yield
    main_mod._warmup_warn_cache.clear()
    main_mod._warmup_notify_cache.clear()


@pytest.mark.asyncio
async def test_sin_handoff_no_envia() -> None:
    adapter = SimpleNamespace(enviar_mensaje=AsyncMock())
    tenant = _fake_tenant("00000000-0000-0000-0000-00000000a001")
    with patch.object(main_mod, "inicializar_pool", AsyncMock(return_value=_FakePool(None))):
        await main_mod._avisar_tenant_warmup_cerca(
            tenant, adapter, {"tier": "fresh", "cap": 30, "sent_today": 25},
        )
    assert adapter.enviar_mensaje.await_count == 0


@pytest.mark.asyncio
async def test_ratio_debajo_80_no_envia() -> None:
    adapter = SimpleNamespace(enviar_mensaje=AsyncMock())
    tenant = _fake_tenant("00000000-0000-0000-0000-00000000a002")
    with patch.object(main_mod, "inicializar_pool", AsyncMock(return_value=_FakePool("+34604000000"))):
        await main_mod._avisar_tenant_warmup_cerca(
            tenant, adapter, {"tier": "fresh", "cap": 30, "sent_today": 23},
        )  # 23/30 = 0.766 < 0.8
    assert adapter.enviar_mensaje.await_count == 0


@pytest.mark.asyncio
async def test_ratio_80_envia_una_vez() -> None:
    adapter = SimpleNamespace(enviar_mensaje=AsyncMock())
    tenant = _fake_tenant("00000000-0000-0000-0000-00000000a003")
    with patch.object(main_mod, "inicializar_pool", AsyncMock(return_value=_FakePool("+34604111111"))):
        await main_mod._avisar_tenant_warmup_cerca(
            tenant, adapter, {"tier": "fresh", "cap": 30, "sent_today": 24},
        )  # 24/30 = 0.8
    assert adapter.enviar_mensaje.await_count == 1
    target, body = adapter.enviar_mensaje.call_args.args
    assert target == "+34604111111"
    assert "Cerca del cap" in body
    assert "Bonets Grill" in body
    assert "24/30" in body
    assert "80%" in body


@pytest.mark.asyncio
async def test_dedupe_mismo_dia_no_reenvia() -> None:
    adapter = SimpleNamespace(enviar_mensaje=AsyncMock())
    tenant = _fake_tenant("00000000-0000-0000-0000-00000000a004")
    with patch.object(main_mod, "inicializar_pool", AsyncMock(return_value=_FakePool("+34604222222"))):
        await main_mod._avisar_tenant_warmup_cerca(
            tenant, adapter, {"tier": "fresh", "cap": 30, "sent_today": 25},
        )
        await main_mod._avisar_tenant_warmup_cerca(
            tenant, adapter, {"tier": "fresh", "cap": 30, "sent_today": 28},
        )
    assert adapter.enviar_mensaje.await_count == 1


@pytest.mark.asyncio
async def test_cap_none_override_skip_silencioso() -> None:
    """tenant con override o mature → cap=None, no hay nada que avisar."""
    adapter = SimpleNamespace(enviar_mensaje=AsyncMock())
    tenant = _fake_tenant("00000000-0000-0000-0000-00000000a005")
    with patch.object(main_mod, "inicializar_pool", AsyncMock(return_value=_FakePool("+34604333333"))):
        await main_mod._avisar_tenant_warmup_cerca(
            tenant, adapter, {"tier": "mature", "cap": None, "sent_today": 9999},
        )
    assert adapter.enviar_mensaje.await_count == 0


@pytest.mark.asyncio
async def test_warn_y_cap_hit_son_independientes() -> None:
    """El mismo tenant puede recibir ambos avisos (warn + cap hit) el mismo día."""
    adapter = SimpleNamespace(enviar_mensaje=AsyncMock())
    tenant = _fake_tenant("00000000-0000-0000-0000-00000000a006")
    with patch.object(main_mod, "inicializar_pool", AsyncMock(return_value=_FakePool("+34604444444"))):
        # warn al 80%
        await main_mod._avisar_tenant_warmup_cerca(
            tenant, adapter, {"tier": "fresh", "cap": 30, "sent_today": 24},
        )
        # cap hit después
        await main_mod._notificar_tenant_warmup_cap(
            tenant, adapter, {"tier": "fresh", "cap": 30, "sent_today": 30},
        )
    assert adapter.enviar_mensaje.await_count == 2
    first_body = adapter.enviar_mensaje.call_args_list[0].args[1]
    second_body = adapter.enviar_mensaje.call_args_list[1].args[1]
    assert "Cerca del cap" in first_body
    assert "Warmup cap alcanzado" in second_body
