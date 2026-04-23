"""Tests del scraper de carta desde URL — `menu_scrape.py`.

Cubre:
- _html_to_text preserva <img src> como [IMG:URL] (fix incidente Bonets
  2026-04-23: scraper sacaba 76 items sin imágenes aunque el HTML las
  tenía).
- _sanitizar_image_url normaliza absolutas / protocol-relative / relativas
  al host / invalidas.
- scrape_url_to_items integra end-to-end con httpx y Claude mockeados.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch
from types import SimpleNamespace

import pytest

from app.menu_scrape import (
    _html_to_text,
    _sanitizar_image_url,
    scrape_url_to_items,
)


class TestHtmlToText:
    def test_preserva_img_src_como_marcador(self) -> None:
        html = '<div><img src="https://cdn.x/burger.webp" alt="Burger"> Dakota Burger 14,90€</div>'
        out = _html_to_text(html)
        assert "[IMG:https://cdn.x/burger.webp]" in out
        assert "Dakota Burger" in out

    def test_varias_imagenes_mantienen_posicion(self) -> None:
        html = (
            '<img src="https://cdn/a.webp"> Item A 1,00€'
            '<img src="https://cdn/b.webp"> Item B 2,00€'
        )
        out = _html_to_text(html)
        idx_a = out.index("[IMG:https://cdn/a.webp]")
        idx_item_a = out.index("Item A")
        idx_b = out.index("[IMG:https://cdn/b.webp]")
        idx_item_b = out.index("Item B")
        # La imagen va justo antes del item asociado.
        assert idx_a < idx_item_a < idx_b < idx_item_b

    def test_img_con_atributos_extra(self) -> None:
        html = '<img loading="lazy" class="foo" src="https://cdn/x.webp" alt="y" width="100">'
        out = _html_to_text(html)
        assert "[IMG:https://cdn/x.webp]" in out

    def test_script_y_style_se_eliminan(self) -> None:
        html = (
            "<script>var x = 1;</script>"
            "<style>.a{color:red}</style>"
            "<p>Texto visible</p>"
        )
        out = _html_to_text(html)
        assert "var x" not in out
        assert "color:red" not in out
        assert "Texto visible" in out

    def test_img_con_comillas_simples(self) -> None:
        html = "<img src='https://cdn/single.webp'>"
        out = _html_to_text(html)
        assert "[IMG:https://cdn/single.webp]" in out


class TestSanitizarImageUrl:
    def test_url_absoluta_https_pasa(self) -> None:
        assert (
            _sanitizar_image_url("https://cdn.x/burger.webp", "https://site.com")
            == "https://cdn.x/burger.webp"
        )

    def test_url_absoluta_http_pasa(self) -> None:
        assert (
            _sanitizar_image_url("http://site.com/img.jpg", "https://site.com")
            == "http://site.com/img.jpg"
        )

    def test_protocol_relative_hereda_scheme(self) -> None:
        assert (
            _sanitizar_image_url("//cdn.x/y.webp", "https://site.com/menu")
            == "https://cdn.x/y.webp"
        )

    def test_relativa_al_host_se_reconstruye(self) -> None:
        assert (
            _sanitizar_image_url("/uploads/burger.jpg", "https://site.com/menu/carta")
            == "https://site.com/uploads/burger.jpg"
        )

    def test_vacio_devuelve_none(self) -> None:
        assert _sanitizar_image_url("", "https://site.com") is None
        assert _sanitizar_image_url("   ", "https://site.com") is None
        assert _sanitizar_image_url(None, "https://site.com") is None

    def test_no_string_devuelve_none(self) -> None:
        assert _sanitizar_image_url(123, "https://site.com") is None
        assert _sanitizar_image_url({"url": "x"}, "https://site.com") is None

    def test_relativa_sin_slash_inicial_devuelve_none(self) -> None:
        # "images/foo.jpg" — demasiado ambiguo, no tratamos de adivinar.
        assert _sanitizar_image_url("images/foo.jpg", "https://site.com/menu") is None

    def test_url_muy_larga_se_recorta(self) -> None:
        long = "https://x.com/" + ("a" * 1000)
        out = _sanitizar_image_url(long, "https://x.com")
        assert out is not None
        assert len(out) <= 500

    def test_emoji_en_path_se_encodea(self) -> None:
        # Fix Bonets 2026-04-23: CloudFront entrega URLs con emojis crudos
        # (🍗 Alitas) que el browser no carga hasta encodearlos.
        raw = "https://cdn.x/images/🍗 Alitas.webp"
        out = _sanitizar_image_url(raw, "https://site.com")
        assert out is not None
        assert "🍗" not in out  # el emoji debe ir percent-encoded
        assert "%F0%9F%8D%97" in out  # 🍗 en UTF-8 percent-encoded
        assert out.endswith(".webp")

    def test_entidad_html_amp_se_decodea(self) -> None:
        # "&amp; Bacon" viene del HTML escaped; debe convertirse en "& Bacon"
        # y luego encodearse como %26.
        raw = "https://cdn.x/images/Aros &amp; Bacon.webp"
        out = _sanitizar_image_url(raw, "https://site.com")
        assert out is not None
        assert "&amp;" not in out
        assert "%26" in out  # & encodeado

    def test_apostrofo_curly_se_preserva_o_encodea(self) -> None:
        # "Bonet's" con apóstrofo curly no rompe el URL.
        raw = "https://cdn.x/images/Bonet's Crispy.webp"
        out = _sanitizar_image_url(raw, "https://site.com")
        assert out is not None
        assert out.startswith("https://cdn.x/")

    def test_path_ya_encodeado_no_se_doble_encoda(self) -> None:
        # Si el path ya tiene %20 (espacio encodeado), no debe convertirse
        # en %2520 (doble encoding).
        raw = "https://cdn.x/images/Torre%20Bonets.webp"
        out = _sanitizar_image_url(raw, "https://site.com")
        assert out == "https://cdn.x/images/Torre%20Bonets.webp"
        assert len(out) <= 500


@pytest.mark.asyncio
async def test_scrape_url_to_items_devuelve_image_url() -> None:
    """End-to-end: httpx devuelve HTML con img, Claude devuelve items con
    image_url, el scraper los incluye en el resultado."""
    html = (
        '<html><body>'
        '<img src="https://cdn/dakota.webp" alt="Dakota"> Dakota Burger 14,90€'
        '</body></html>'
    )
    fake_http_resp = SimpleNamespace(status_code=200, text=html)

    class FakeAsyncClient:
        def __init__(self, *a, **k): ...
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def get(self, *a, **k): return fake_http_resp

    fake_claude_resp = SimpleNamespace(
        content=[SimpleNamespace(
            type="text",
            text='{"items":[{"name":"Dakota Burger","category":"Burgers","price_cents":1490,"image_url":"https://cdn/dakota.webp"}]}',
        )],
    )
    fake_client = SimpleNamespace(
        messages=SimpleNamespace(create=AsyncMock(return_value=fake_claude_resp)),
    )

    with (
        patch("app.menu_scrape.httpx.AsyncClient", FakeAsyncClient),
        patch("app.menu_scrape._get_client", return_value=fake_client),
    ):
        result = await scrape_url_to_items(
            "https://site.com/menu", anthropic_api_key="sk-fake",
        )

    assert len(result) == 1
    assert result[0]["name"] == "Dakota Burger"
    assert result[0]["image_url"] == "https://cdn/dakota.webp"
    assert result[0]["price_cents"] == 1490


@pytest.mark.asyncio
async def test_scrape_url_to_items_image_url_opcional() -> None:
    """Si Claude omite image_url, el item sigue siendo válido con None."""
    fake_http_resp = SimpleNamespace(
        status_code=200,
        text=(
            "<html><body><h1>Carta del Restaurante</h1>"
            "<section><h2>Bebidas</h2>"
            "<p>Coca-Cola 2€ — refresco clásico bien frío</p>"
            "<p>Agua mineral 1,50€ — botella de 500ml</p>"
            "<p>Zumo de naranja 3€ — recién exprimido cada mañana</p>"
            "</section></body></html>"
        ),
    )

    class FakeAsyncClient:
        def __init__(self, *a, **k): ...
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def get(self, *a, **k): return fake_http_resp

    fake_claude_resp = SimpleNamespace(
        content=[SimpleNamespace(
            type="text",
            text='{"items":[{"name":"Coca-Cola","category":"Bebidas","price_cents":200}]}',
        )],
    )
    fake_client = SimpleNamespace(
        messages=SimpleNamespace(create=AsyncMock(return_value=fake_claude_resp)),
    )

    with (
        patch("app.menu_scrape.httpx.AsyncClient", FakeAsyncClient),
        patch("app.menu_scrape._get_client", return_value=fake_client),
    ):
        result = await scrape_url_to_items(
            "https://site.com/menu", anthropic_api_key="sk-fake",
        )

    assert len(result) == 1
    assert result[0]["image_url"] is None


@pytest.mark.asyncio
async def test_scrape_url_to_items_descarta_image_url_invalida() -> None:
    """Si Claude devuelve una image_url que no es URL válida, se descarta."""
    fake_http_resp = SimpleNamespace(
        status_code=200,
        text=(
            "<html><body><h1>Menu del Local</h1>"
            "<section><h2>Entrantes</h2>"
            "<p>Item X 5€ — descripcion suficiente para pasar el minimo de caracteres</p>"
            "<p>Item Y 3,50€ — otro entrante con suficiente texto en la pagina</p>"
            "</section></body></html>"
        ),
    )

    class FakeAsyncClient:
        def __init__(self, *a, **k): ...
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def get(self, *a, **k): return fake_http_resp

    fake_claude_resp = SimpleNamespace(
        content=[SimpleNamespace(
            type="text",
            text='{"items":[{"name":"Item X","category":"Otros","price_cents":500,"image_url":"no-es-url"}]}',
        )],
    )
    fake_client = SimpleNamespace(
        messages=SimpleNamespace(create=AsyncMock(return_value=fake_claude_resp)),
    )

    with (
        patch("app.menu_scrape.httpx.AsyncClient", FakeAsyncClient),
        patch("app.menu_scrape._get_client", return_value=fake_client),
    ):
        result = await scrape_url_to_items(
            "https://site.com/menu", anthropic_api_key="sk-fake",
        )

    assert len(result) == 1
    assert result[0]["image_url"] is None
