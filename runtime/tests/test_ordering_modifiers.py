"""Mig 042 — cierre deuda técnica PR #113.

Tests del soporte de modifiers en `runtime.app.ordering.crear_pedido`:
- El payload enviado a /api/orders incluye `modifiers` con la forma que el
  Zod schema de la web acepta (groupId/modifierId/name/priceDeltaCents).
- priceDelta en EUROS se convierte a céntimos con redondeo.
- Modifiers ausentes / vacíos no rompen retro-compat.
- priceDelta negativo → se filtra (defensa-en-profundidad).
- El tool schema `crear_pedido` declara el campo `modifiers` con name +
  priceDelta y la regla 13 del prompt_wrapper documenta el flujo nuevo.
"""
from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from app import brain
from app.ordering import crear_pedido
from app.prompt_wrapper import PROMPT_WRAPPER


def _crear_pedido_tool() -> dict[str, Any]:
    return next(t for t in brain.TOOLS if t["name"] == "crear_pedido")


def _items_schema() -> dict[str, Any]:
    return _crear_pedido_tool()["input_schema"]["properties"]["items"]["items"]


# ──────────────────────────────────────────────────────────────────────
# Tool schema
# ──────────────────────────────────────────────────────────────────────


def test_tool_schema_expone_modifiers_array() -> None:
    """La tool debe declarar `modifiers` como array — sin esto, el LLM no
    puede pasar modifiers estructurados y caería de vuelta a notes."""
    item_schema = _items_schema()
    props = item_schema["properties"]
    assert "modifiers" in props, "items.modifiers debe estar en el schema"
    mods = props["modifiers"]
    assert mods["type"] == "array"
    sub = mods["items"]
    assert sub["type"] == "object"
    assert "name" in sub["required"]
    assert "name" in sub["properties"]
    assert sub["properties"]["name"]["type"] == "string"
    # priceDelta en EUROS, opcional, >=0.
    assert "priceDelta" in sub["properties"]
    assert sub["properties"]["priceDelta"]["minimum"] == 0


def test_prompt_wrapper_explica_pasar_modifiers_al_tool() -> None:
    """Sin instrucción explícita, el LLM pasa los modifiers en notes en vez
    del array. La regla 13 debe instruir el flujo nuevo (mig 042)."""
    txt = PROMPT_WRAPPER
    assert "modifiers" in txt.lower()
    # Mención clave: priceDelta en euros + ejemplo.
    assert "priceDelta" in txt or "price_delta" in txt
    assert "EUROS" in txt or "euros" in txt


# ──────────────────────────────────────────────────────────────────────
# crear_pedido HTTP payload
# ──────────────────────────────────────────────────────────────────────


def _stub_http_response(status_code: int = 200, body: dict[str, Any] | None = None):
    response = type(
        "R",
        (),
        {
            "status_code": status_code,
            "json": lambda self: body or {"orderId": "o1", "totalCents": 0, "currency": "EUR", "isTest": False},
            "text": "",
        },
    )()
    return response


@pytest.mark.asyncio
async def test_crear_pedido_envia_modifiers_con_priceDeltaCents(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Cuando el LLM pasa modifiers con priceDelta en EUROS, ordering.py
    los reenvía en céntimos a la web."""
    monkeypatch.setenv("ORDY_WEB_URL", "https://example.test")
    monkeypatch.setenv("RUNTIME_INTERNAL_SECRET", "secret")

    captured: dict[str, Any] = {}

    async def fake_post(url: str, *, json: dict[str, Any], headers: dict[str, str]) -> Any:
        captured["json"] = json
        return _stub_http_response()

    fake_client = AsyncMock()
    fake_client.post = fake_post
    with patch("app.ordering._get_http", return_value=fake_client):
        await crear_pedido(
            tenant_slug="demo",
            items=[
                {
                    "name": "Dacoka Burger",
                    "quantity": 1,
                    "unit_price_cents": 1200,
                    "modifiers": [
                        {"name": "Tamaño grande", "priceDelta": 3.00},
                        {"name": "Extra queso", "priceDelta": 1.50},
                        {"name": "Sin cebolla", "priceDelta": 0},
                    ],
                }
            ],
            customer_name="Mario",
            order_type="takeaway",
        )

    item = captured["json"]["items"][0]
    assert "modifiers" in item, "el payload web debe incluir modifiers"
    mods = item["modifiers"]
    assert len(mods) == 3
    # Conversión EUROS → céntimos con round() para evitar errores de coma flotante.
    assert mods[0]["name"] == "Tamaño grande"
    assert mods[0]["priceDeltaCents"] == 300
    assert mods[1]["name"] == "Extra queso"
    assert mods[1]["priceDeltaCents"] == 150
    assert mods[2]["name"] == "Sin cebolla"
    assert mods[2]["priceDeltaCents"] == 0
    # Cada modifier trae groupId/modifierId no vacíos (el bot inventa
    # placeholders estables; el schema los exige).
    for m in mods:
        assert isinstance(m["groupId"], str) and m["groupId"]
        assert isinstance(m["modifierId"], str) and m["modifierId"]


@pytest.mark.asyncio
async def test_crear_pedido_sin_modifiers_no_rompe_retro_compat(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Items legacy sin campo modifiers → el payload tampoco trae el campo."""
    monkeypatch.setenv("ORDY_WEB_URL", "https://example.test")
    monkeypatch.setenv("RUNTIME_INTERNAL_SECRET", "secret")
    captured: dict[str, Any] = {}

    async def fake_post(url: str, *, json: dict[str, Any], headers: dict[str, str]) -> Any:
        captured["json"] = json
        return _stub_http_response()

    fake_client = AsyncMock()
    fake_client.post = fake_post
    with patch("app.ordering._get_http", return_value=fake_client):
        await crear_pedido(
            tenant_slug="demo",
            items=[{"name": "Coca-Cola", "quantity": 1, "unit_price_cents": 250}],
            customer_name="Mario",
            order_type="takeaway",
        )

    item = captured["json"]["items"][0]
    assert "modifiers" not in item, "items sin modifiers no deben adjuntar el campo"


@pytest.mark.asyncio
async def test_crear_pedido_modifiers_vacios_no_adjunta_campo(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """modifiers=[] explícito → tampoco se adjunta (evita ruido en el wire)."""
    monkeypatch.setenv("ORDY_WEB_URL", "https://example.test")
    monkeypatch.setenv("RUNTIME_INTERNAL_SECRET", "secret")
    captured: dict[str, Any] = {}

    async def fake_post(url: str, *, json: dict[str, Any], headers: dict[str, str]) -> Any:
        captured["json"] = json
        return _stub_http_response()

    fake_client = AsyncMock()
    fake_client.post = fake_post
    with patch("app.ordering._get_http", return_value=fake_client):
        await crear_pedido(
            tenant_slug="demo",
            items=[
                {
                    "name": "Coca-Cola",
                    "quantity": 1,
                    "unit_price_cents": 250,
                    "modifiers": [],
                }
            ],
            customer_name="Mario",
            order_type="takeaway",
        )
    item = captured["json"]["items"][0]
    assert "modifiers" not in item


@pytest.mark.asyncio
async def test_crear_pedido_filtra_priceDelta_negativo(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Caller maligno o LLM confundido pasa priceDelta=-2 (descuento) →
    el código clampa a 0 antes de enviar a la web. La web también lo
    rechazaría por Zod (min 0), pero defensa-en-profundidad."""
    monkeypatch.setenv("ORDY_WEB_URL", "https://example.test")
    monkeypatch.setenv("RUNTIME_INTERNAL_SECRET", "secret")
    captured: dict[str, Any] = {}

    async def fake_post(url: str, *, json: dict[str, Any], headers: dict[str, str]) -> Any:
        captured["json"] = json
        return _stub_http_response()

    fake_client = AsyncMock()
    fake_client.post = fake_post
    with patch("app.ordering._get_http", return_value=fake_client):
        await crear_pedido(
            tenant_slug="demo",
            items=[
                {
                    "name": "Burger",
                    "quantity": 1,
                    "unit_price_cents": 1200,
                    "modifiers": [
                        {"name": "Extra queso", "priceDelta": 1.50},
                        {"name": "Hack descuento", "priceDelta": -5.00},
                    ],
                }
            ],
            customer_name="Mario",
            order_type="takeaway",
        )

    mods = captured["json"]["items"][0]["modifiers"]
    # Ambos viajan (la web filtra estricto), pero el delta negativo se
    # clampa a 0 antes del wire.
    deltas = [m["priceDeltaCents"] for m in mods]
    assert min(deltas) >= 0
    # El que era +1.50 mantiene su valor.
    assert 150 in deltas


@pytest.mark.asyncio
async def test_crear_pedido_priceDelta_decimal_redondea_a_centimos(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """0.10 EUR → 10 céntimos. 0.105 → 11 (round-half-even). Sin esto
    los floats sucios de la API LLM darían off-by-one."""
    monkeypatch.setenv("ORDY_WEB_URL", "https://example.test")
    monkeypatch.setenv("RUNTIME_INTERNAL_SECRET", "secret")
    captured: dict[str, Any] = {}

    async def fake_post(url: str, *, json: dict[str, Any], headers: dict[str, str]) -> Any:
        captured["json"] = json
        return _stub_http_response()

    fake_client = AsyncMock()
    fake_client.post = fake_post
    with patch("app.ordering._get_http", return_value=fake_client):
        await crear_pedido(
            tenant_slug="demo",
            items=[
                {
                    "name": "X",
                    "quantity": 1,
                    "unit_price_cents": 1000,
                    "modifiers": [
                        {"name": "A", "priceDelta": 0.10},
                        {"name": "B", "priceDelta": 1.99},
                    ],
                }
            ],
            customer_name="Mario",
            order_type="takeaway",
        )
    deltas = [m["priceDeltaCents"] for m in captured["json"]["items"][0]["modifiers"]]
    assert deltas == [10, 199]


@pytest.mark.asyncio
async def test_crear_pedido_modifiers_con_groupId_modifierId_explicitos_se_respetan(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Cuando el caller (widget público end-to-end) ya conoce los IDs reales
    de DB, el bridge debe respetarlos y no sobreescribirlos."""
    monkeypatch.setenv("ORDY_WEB_URL", "https://example.test")
    monkeypatch.setenv("RUNTIME_INTERNAL_SECRET", "secret")
    captured: dict[str, Any] = {}

    async def fake_post(url: str, *, json: dict[str, Any], headers: dict[str, str]) -> Any:
        captured["json"] = json
        return _stub_http_response()

    fake_client = AsyncMock()
    fake_client.post = fake_post
    with patch("app.ordering._get_http", return_value=fake_client):
        await crear_pedido(
            tenant_slug="demo",
            items=[
                {
                    "name": "Pizza",
                    "quantity": 1,
                    "unit_price_cents": 1000,
                    "modifiers": [
                        {
                            "groupId": "grp-uuid-real",
                            "modifierId": "mod-uuid-real",
                            "name": "Grande",
                            "priceDelta": 3.00,
                        }
                    ],
                }
            ],
            customer_name="Mario",
            order_type="takeaway",
        )
    m = captured["json"]["items"][0]["modifiers"][0]
    assert m["groupId"] == "grp-uuid-real"
    assert m["modifierId"] == "mod-uuid-real"
    assert m["priceDeltaCents"] == 300
