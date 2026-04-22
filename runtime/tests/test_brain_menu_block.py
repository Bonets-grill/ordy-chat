"""Regresión Fase B mig 028: bloque <carta> dinámico + tool consultar_carta.

Verifica:
- Helper _build_menu_block existe y agrupa por categoría con precios formato ES.
- Brain inyecta el bloque en system_blocks tras menu_overrides.
- Tool consultar_carta registrada con query required.
- menu_search.buscar_items existe y tiene query con LOWER + ranking.

Estructurales — no invocan a Claude ni Postgres.
"""

from __future__ import annotations

import inspect

from app import brain, menu_search


def _carta_tool() -> dict:
    return next(t for t in brain.TOOLS if t["name"] == "consultar_carta")


def test_consultar_carta_tool_existe_con_query_required() -> None:
    tool = _carta_tool()
    schema = tool["input_schema"]
    assert schema["required"] == ["query"]
    assert schema["properties"]["query"]["type"] == "string"
    assert schema["properties"]["query"]["minLength"] == 2


def test_build_menu_block_existe_y_agrupa_por_categoria() -> None:
    src = inspect.getsource(brain._build_menu_block)
    assert "FROM menu_items" in src
    assert "available = true" in src
    assert "ORDER BY category, sort_order, name" in src
    # Agrupación por categoría con encabezado markdown ###.
    assert "### " in src or "f\"\\n### {cat}\"" in src
    # Formato precio español (coma decimal).
    assert "\".\", \",\"" in src or "replace(\".\"" in src or "replace('.'" in src
    # Bloque XML <carta>.
    assert "<carta>" in src
    assert "</carta>" in src


def test_brain_inyecta_carta_block_antes_de_overrides() -> None:
    """El bloque <carta> debe ir ANTES de <disponibilidad_hoy> para que las
    overrides actúen como parche encima de la carta base."""
    src = inspect.getsource(brain.generar_respuesta)
    assert "_build_menu_block" in src
    idx_carta = src.find("_build_menu_block")
    idx_overrides = src.find("_build_menu_overrides_block")
    assert idx_carta >= 0 and idx_overrides >= 0
    assert idx_carta < idx_overrides, (
        "<carta> debe inyectarse ANTES que <disponibilidad_hoy> "
        "para que los overrides actúen como parche."
    )


def test_buscar_items_tiene_ranking_lower_case() -> None:
    src = inspect.getsource(menu_search.buscar_items)
    assert "FROM menu_items" in src
    assert "available = true" in src
    # Ranking exact > prefix > substring > description.
    assert "LOWER(name) = LOWER" in src
    assert "LIKE '%' || LOWER" in src
    assert "ORDER BY rank" in src


def test_consultar_carta_handler_invoca_buscar_items() -> None:
    """El handler de consultar_carta en brain debe llamar a buscar_items
    (no inventar resultados)."""
    src = inspect.getsource(brain._ejecutar_tool)
    assert 'tool_name == "consultar_carta"' in src
    assert "buscar_items" in src or "menu_search" in src
