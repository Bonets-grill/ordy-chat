"""Tests del flag `warmup_override` en provider_credentials (mig 025).

Contexto P0 2026-04-20: el warmup anti-ban Evolution bloqueó a Bonets Grill
con tier fresh=30 un lunes abierto. El workaround fue back-datar
`instance_created_at`, frágil y sin trazabilidad. El override formal permite
al super admin saltar el cap diario de forma auditable (quién, cuándo, por qué)
sin tocar `instance_created_at`.

Precedencia:
  1. burned=true  → bloquea siempre (kill-switch).
  2. warmup_override=true → salta cap, reporta override=true.
  3. provider!=evolution → sin cap.
  4. Cap normal por tier.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch
from uuid import UUID

import pytest

from app import warmup as warmup_mod


class _FakeConn:
    def __init__(self, row: dict | None):
        self._row = row

    async def fetchrow(self, _sql: str, _tenant_id):
        return self._row


class _FakePoolCtx:
    def __init__(self, row: dict | None):
        self._row = row

    async def __aenter__(self):
        return _FakeConn(self._row)

    async def __aexit__(self, *a):
        return None


class _FakePool:
    def __init__(self, row: dict | None):
        self._row = row

    def acquire(self):
        return _FakePoolCtx(self._row)


_TENANT = UUID("00000000-0000-0000-0000-000000000001")


@pytest.mark.asyncio
async def test_override_true_salta_cap_aunque_sea_fresh() -> None:
    """fresh día 0 + override → pasa sin cap."""
    row = {"provider": "evolution", "burned": False, "warmup_override": True, "dias": 0}
    with patch.object(warmup_mod, "inicializar_pool", AsyncMock(return_value=_FakePool(row))):
        estado = await warmup_mod.chequear_warmup(_TENANT)
    assert estado["blocked"] is False
    assert estado["override"] is True
    assert estado["cap"] is None
    assert estado["tier"] == "fresh"  # edad real preservada


@pytest.mark.asyncio
async def test_burned_gana_sobre_override() -> None:
    """burned=true es kill-switch — override NO lo salta."""
    row = {"provider": "evolution", "burned": True, "warmup_override": True, "dias": 0}
    with patch.object(warmup_mod, "inicializar_pool", AsyncMock(return_value=_FakePool(row))):
        estado = await warmup_mod.chequear_warmup(_TENANT)
    assert estado["blocked"] is True
    assert estado["reason"] == "burned"
    assert estado["tier"] == "burned"


@pytest.mark.asyncio
async def test_override_false_mantiene_cap_fresh() -> None:
    """Sin override, fresh día 0 sigue bloqueando al alcanzar 30 msgs."""
    row = {"provider": "evolution", "burned": False, "warmup_override": False, "dias": 0}
    with patch.object(warmup_mod, "inicializar_pool", AsyncMock(return_value=_FakePool(row))), \
         patch.object(warmup_mod, "mensajes_assistant_hoy", AsyncMock(return_value=30)):
        estado = await warmup_mod.chequear_warmup(_TENANT)
    assert estado["blocked"] is True
    assert estado["reason"] == "warmup_cap"
    assert estado["cap"] == 30
    assert estado["sent_today"] == 30
    assert estado["override"] is False


@pytest.mark.asyncio
async def test_override_reporta_tier_real_no_mature() -> None:
    """Día 5 con override → tier early (real), no disfrazado de mature."""
    row = {"provider": "evolution", "burned": False, "warmup_override": True, "dias": 5}
    with patch.object(warmup_mod, "inicializar_pool", AsyncMock(return_value=_FakePool(row))):
        estado = await warmup_mod.chequear_warmup(_TENANT)
    assert estado["blocked"] is False
    assert estado["override"] is True
    assert estado["tier"] == "early"


@pytest.mark.asyncio
async def test_provider_whapi_no_toca_override() -> None:
    """Provider no-Evolution nunca entra al path del override."""
    row = {"provider": "whapi", "burned": False, "warmup_override": False, "dias": 0}
    with patch.object(warmup_mod, "inicializar_pool", AsyncMock(return_value=_FakePool(row))):
        estado = await warmup_mod.chequear_warmup(_TENANT)
    assert estado["blocked"] is False
    assert estado["tier"] == "mature"
    assert estado["override"] is False
