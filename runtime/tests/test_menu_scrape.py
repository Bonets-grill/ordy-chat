"""Tests del scraper de carta desde URL — `menu_scrape.py` v2.

Cubre el nuevo pipeline determinista (2026-04-23):
- _html_to_text strippea tags limpiamente (sin marcadores [IMG:...]).
- _slugify normaliza strings para match fuzzy.
- _extract_image_urls_with_positions extrae URLs INTACTAS del HTML.
- _match_images_to_items asocia items↔imágenes en Python (no LLM).
- _sanitizar_image_url encodea emojis/apóstrofos para el browser.
- scrape_url_to_items integra todo end-to-end.

El pipeline viejo pasaba URLs al LLM, que corrompía apóstrofos curly
(''→`'`) y CloudFront devolvía 403. Estos tests cementan el nuevo
approach determinista que preserva las URLs exactas del HTML.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch
from types import SimpleNamespace

import pytest

from app.menu_scrape import (
    _extract_image_urls_with_positions,
    _html_to_text,
    _match_images_to_items,
    _sanitizar_image_url,
    _slugify,
    scrape_url_to_items,
)


class TestHtmlToText:
    def test_strippea_todas_las_tags(self) -> None:
        html = '<div><img src="https://cdn/burger.webp"><p>Dakota Burger 14,90€</p></div>'
        out = _html_to_text(html)
        assert "<" not in out
        assert ">" not in out
        assert "Dakota Burger" in out
        assert "14,90" in out

    def test_script_y_style_se_eliminan(self) -> None:
        html = "<script>var x=1;</script><style>.a{}</style><p>Texto visible</p>"
        out = _html_to_text(html)
        assert "var x" not in out
        assert "Texto visible" in out


class TestSlugify:
    def test_minusculas_sin_acentos_sin_simbolos(self) -> None:
        assert _slugify("Bonet's Crispy Chicken") == "bonetscrispychicken"
        assert _slugify("Jalapeños Bonet's") == "jalapenosbonets"
        assert _slugify("8 Dedos de queso mozzarella") == "8dedosdequesomozzarella"

    def test_curly_quote_no_altera_slug(self) -> None:
        # Apóstrofo curly (U+2019) y ASCII deben producir mismo slug.
        assert _slugify("Bonet’s") == _slugify("Bonet's") == "bonets"

    def test_vacio(self) -> None:
        assert _slugify("") == ""
        assert _slugify("   ") == ""


class TestExtractImageUrlsWithPositions:
    def test_extrae_urls_intactas_con_emojis_y_curly(self) -> None:
        # URLs reales del HTML de codemida — con emojis y apóstrofo curly.
        html = (
            '<img src="https://cdn/1744390276481-🍗 Bonet’s Crispy Chicken -242.webp">'
            '<p>Bonet’s Crispy Chicken 12,90€</p>'
            '<img src="https://cdn/1744390174290-🌶 Bonet’s Spicy Chicken-344.webp">'
            '<p>Bonet’s Spicy Chicken 13,90€</p>'
        )
        result = _extract_image_urls_with_positions(html)
        assert len(result) == 2
        # Las URLs deben preservar emojis y apóstrofos curly SIN modificar.
        assert "🍗" in result[0][0]
        assert "’" in result[0][0]
        assert "🌶" in result[1][0]

    def test_ignora_data_uris(self) -> None:
        html = '<img src="data:image/gif;base64,AAAA"><img src="https://cdn/real.webp">'
        result = _extract_image_urls_with_positions(html)
        assert len(result) == 1
        assert result[0][0] == "https://cdn/real.webp"


class TestMatchImagesToItems:
    def test_match_por_nombre_en_filename(self) -> None:
        """El filename contiene el nombre del item → match directo."""
        html = (
            '<img src="https://cdn/1744390276481-🍗 Bonet’s Crispy Chicken -242.webp">'
            '<p>Bonet’s Crispy Chicken 12,90€</p>'
        )
        items = [{"name": "Bonet’s Crispy Chicken"}]
        _match_images_to_items(html, items)
        assert items[0]["_matched_image_raw"] is not None
        assert "Crispy Chicken" in items[0]["_matched_image_raw"]

    def test_curly_vs_ascii_apostrofo_matchean_igual(self) -> None:
        """Bug real Bonets: DB tenía 'Bonet's' (ASCII) pero HTML tiene
        'Bonet's' (curly). _slugify normaliza ambos al mismo slug."""
        html = (
            '<img src="https://cdn/Bonet’s Crispy-1.webp">'
            '<p>Bonet’s Crispy 10€</p>'
        )
        items = [{"name": "Bonet's Crispy"}]  # ASCII, como lo devuelve el LLM
        _match_images_to_items(html, items)
        # Debe matchear aunque los apóstrofos sean distintos.
        assert items[0]["_matched_image_raw"] is not None
        assert "’" in items[0]["_matched_image_raw"]  # preserva curly

    def test_una_imagen_no_se_reusa(self) -> None:
        """Dos items parecidos no deben compartir la misma imagen."""
        html = (
            '<img src="https://cdn/burger-a.webp">'
            '<p>Burger A 10€</p>'
            '<p>Burger B 11€</p>'
        )
        items = [{"name": "Burger A"}, {"name": "Burger B"}]
        _match_images_to_items(html, items)
        assert items[0]["_matched_image_raw"] == "https://cdn/burger-a.webp"
        # Burger B no tiene imagen propia ni proximidad previa no-usada.
        assert items[1]["_matched_image_raw"] is None

    def test_fallback_proximidad_dom(self) -> None:
        """Si filename no contiene el nombre, usa la img más cercana previa."""
        html = (
            '<img src="https://cdn/generic-1.webp">'
            '<p>Coca-Cola 2€</p>'
        )
        items = [{"name": "Coca-Cola"}]
        _match_images_to_items(html, items)
        assert items[0]["_matched_image_raw"] == "https://cdn/generic-1.webp"

    def test_sin_imagen_disponible(self) -> None:
        html = '<p>Item sin imagen 5€</p>'
        items = [{"name": "Item sin imagen"}]
        _match_images_to_items(html, items)
        assert items[0]["_matched_image_raw"] is None

    def test_filename_con_amp_entity_matchea(self) -> None:
        """Bug Bonets 2026-04-23: "Aros &amp; Bacon" en filename del HTML
        no matcheaba el item "Aros de Queso & Bacon" (slug). Fix: unescape
        HTML entities en filename antes de slugify."""
        html = (
            '<img src="https://cdn/Aros de Queso &amp; Bacon.webp">'
            '<p>Aros de Queso &amp; Bacon 8,90€</p>'
        )
        items = [{"name": "Aros de Queso & Bacon"}]
        _match_images_to_items(html, items)
        assert items[0]["_matched_image_raw"] is not None
        assert "Bacon" in items[0]["_matched_image_raw"]


class TestSanitizarImageUrl:
    def test_url_absoluta_https_pasa(self) -> None:
        assert (
            _sanitizar_image_url("https://cdn.x/burger.webp", "https://site.com")
            == "https://cdn.x/burger.webp"
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
        assert _sanitizar_image_url(None, "https://site.com") is None

    def test_emoji_se_encodea_como_utf8(self) -> None:
        raw = "https://cdn.x/🍗 Alitas.webp"
        out = _sanitizar_image_url(raw, "https://site.com")
        assert out is not None
        assert "🍗" not in out
        assert "%F0%9F%8D%97" in out  # 🍗 UTF-8 percent-encoded

    def test_apostrofo_curly_se_encodea_distinto_de_ascii(self) -> None:
        """Bug Bonets 2026-04-23: apóstrofo curly (U+2019) encodeado DEBE
        ser %E2%80%99, NO %27 (que es el ASCII). CloudFront busca el
        archivo literal con curly → 200 OK; con ASCII → 403."""
        raw_curly = "https://cdn.x/Bonet’s Crispy.webp"
        out_curly = _sanitizar_image_url(raw_curly, "https://site.com")
        assert out_curly is not None
        assert "%E2%80%99" in out_curly
        assert "%27" not in out_curly  # NO convertir a ASCII

    def test_entidad_html_amp_se_decodea(self) -> None:
        raw = "https://cdn.x/Aros &amp; Bacon.webp"
        out = _sanitizar_image_url(raw, "https://site.com")
        assert out is not None
        assert "&amp;" not in out
        assert "%26" in out

    def test_path_ya_encodeado_no_se_doble_encoda(self) -> None:
        raw = "https://cdn.x/Torre%20Bonets.webp"
        out = _sanitizar_image_url(raw, "https://site.com")
        assert out == "https://cdn.x/Torre%20Bonets.webp"

    def test_url_muy_larga_se_recorta(self) -> None:
        long = "https://x.com/" + ("a" * 1000)
        out = _sanitizar_image_url(long, "https://x.com")
        assert out is not None
        assert len(out) <= 500


# ── End-to-end ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_scrape_url_to_items_preserva_apostrofo_curly() -> None:
    """Reproduce el bug Bonets: LLM devuelve 'Bonet's Crispy' (ASCII),
    el HTML real tiene 'Bonet’s Crispy Chicken' (curly). El matcher
    determinista debe asociar correctamente y devolver la URL con curly
    preservado, que tras _sanitizar queda como %E2%80%99 (no %27)."""
    html_con_curly = (
        "<html><body>"
        "<h2>Pollo</h2>"
        '<img src="https://cdn/1744390276481-🍗 Bonet’s Crispy Chicken -242.webp">'
        '<p>Bonet’s Crispy Chicken 12,90€ pechuga empanada con queso</p>'
        "</body></html>"
    )
    fake_http_resp = SimpleNamespace(status_code=200, text=html_con_curly)

    class FakeAsyncClient:
        def __init__(self, *a, **k): ...
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def get(self, *a, **k): return fake_http_resp

    # El LLM devuelve el nombre con apóstrofo ASCII (comportamiento real
    # de Haiku — "corrige" los apóstrofos curly). El matcher debe
    # asociar igualmente contra el HTML curly.
    fake_claude_resp = SimpleNamespace(
        stop_reason="end_turn",
        content=[SimpleNamespace(
            type="text",
            text='{"items":[{"name":"Bonet\'s Crispy Chicken","category":"Pollo","price_cents":1290}]}',
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
            "https://codemida.com/menus/x", anthropic_api_key="sk-fake",
        )

    assert len(result) == 1
    url = result[0]["image_url"]
    assert url is not None
    # La URL final DEBE tener el apóstrofo curly encodeado correctamente.
    assert "%E2%80%99" in url
    # Y NO debe tener el apóstrofo ASCII encodeado (ese es el bug).
    assert "%27" not in url
    assert "Crispy" in url


@pytest.mark.asyncio
async def test_scrape_url_to_items_sin_imagen_disponible() -> None:
    """Items cuyos nombres no matchean ninguna img del HTML quedan con
    image_url=None — no se inventa ni se reusa otra imagen."""
    html = (
        "<html><body>"
        "<h2>Bebidas</h2>"
        "<p>Coca-Cola 2€ refresco clásico bien frío de la nevera del bar</p>"
        "<p>Agua mineral 1,50€ botella fresca de medio litro</p>"
        "</body></html>"
    )
    fake_http_resp = SimpleNamespace(status_code=200, text=html)

    class FakeAsyncClient:
        def __init__(self, *a, **k): ...
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def get(self, *a, **k): return fake_http_resp

    fake_claude_resp = SimpleNamespace(
        stop_reason="end_turn",
        content=[SimpleNamespace(
            type="text",
            text='{"items":[{"name":"Coca-Cola","category":"Bebidas","price_cents":200},{"name":"Agua","category":"Bebidas","price_cents":150}]}',
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
            "https://x/menu", anthropic_api_key="sk-fake",
        )

    assert len(result) == 2
    assert all(it["image_url"] is None for it in result)


@pytest.mark.asyncio
async def test_scrape_url_to_items_el_llm_no_recibe_urls() -> None:
    """Sanity: el LLM NO debe ver URLs de imagen. Si las viera, las
    corrompería (bug Bonets). El payload que va a messages.create tiene
    sólo texto plano sin http/https de imágenes reales."""
    html = (
        "<html><body>"
        '<img src="https://cdn/should-not-reach-llm.webp">'
        "<p>Item X 5€ descripción suficiente para pasar el minimo de caracteres</p>"
        "</body></html>"
    )
    fake_http_resp = SimpleNamespace(status_code=200, text=html)

    class FakeAsyncClient:
        def __init__(self, *a, **k): ...
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def get(self, *a, **k): return fake_http_resp

    captured_payload: dict = {}

    async def fake_create(**kwargs):
        captured_payload.update(kwargs)
        return SimpleNamespace(
            stop_reason="end_turn",
            content=[SimpleNamespace(
                type="text",
                text='{"items":[{"name":"Item X","category":"Otros","price_cents":500}]}',
            )],
        )

    fake_client = SimpleNamespace(
        messages=SimpleNamespace(create=fake_create),
    )

    with (
        patch("app.menu_scrape.httpx.AsyncClient", FakeAsyncClient),
        patch("app.menu_scrape._get_client", return_value=fake_client),
    ):
        await scrape_url_to_items("https://x/menu", anthropic_api_key="sk-fake")

    user_content = captured_payload["messages"][0]["content"]
    assert "should-not-reach-llm" not in user_content, (
        "Las URLs de imagen NO deben pasarse al LLM — se corrompen los "
        "apóstrofos curly. Sólo texto plano."
    )
