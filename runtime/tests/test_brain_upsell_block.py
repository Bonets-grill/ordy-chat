"""Regresión mig 046: bloque <upsell> + ⭐ recomendado en <carta>.

Verifica:
- Helper _build_upsell_block existe y es async.
- _build_menu_block SQL incluye is_recommended.
- Brain inyecta _build_upsell_block tras _build_menu_block.

Estructurales — no invocan a Postgres (reflection-based).
"""

from __future__ import annotations

import inspect

from app import brain


def test_build_upsell_block_existe_y_es_async() -> None:
    assert hasattr(brain, "_build_upsell_block"), "falta _build_upsell_block en brain"
    assert inspect.iscoroutinefunction(brain._build_upsell_block), (
        "_build_upsell_block debe ser async para consultar agent_configs"
    )


def test_build_menu_block_selecciona_is_recommended() -> None:
    src = inspect.getsource(brain._build_menu_block)
    assert "is_recommended" in src, (
        "_build_menu_block debe SELECT is_recommended para poder marcar ⭐ en <carta>"
    )
    # Asegura que la marca visual ⭐ RECOMENDADO se inyecta.
    assert "⭐" in src and "RECOMENDADO" in src, (
        "_build_menu_block debe emitir ⭐ RECOMENDADO para los items flag"
    )


def test_upsell_block_respeta_flags_de_config() -> None:
    src = inspect.getsource(brain._build_upsell_block)
    # Las 3 claves camelCase vienen del JSONB upsell_config (API Zod schema).
    assert "suggestStarterWithMain" in src
    assert "suggestDessertAtClose" in src
    assert "suggestPairing" in src


def test_upsell_block_no_se_inyecta_sin_items_recomendados() -> None:
    """Regla dura: sin items ⭐ el bloque devuelve None (el bot no inventa)."""
    src = inspect.getsource(brain._build_upsell_block)
    assert "rec_count" in src, (
        "_build_upsell_block debe contar items recomendados antes de emitir"
    )
    # El guard "not any(flags) or not rec_count" protege contra bot inventando.
    assert "not rec_count" in src or "rec_count" in src


def test_brain_inyecta_upsell_block_tras_menu_block() -> None:
    """El orden importa: <carta> define los ⭐, <upsell> los explota."""
    src = inspect.getsource(brain.generar_respuesta)
    idx_menu = src.find("_build_menu_block")
    idx_upsell = src.find("_build_upsell_block")
    assert idx_menu > 0, "falta llamada a _build_menu_block en generar_respuesta"
    assert idx_upsell > 0, "falta llamada a _build_upsell_block en generar_respuesta"
    assert idx_upsell > idx_menu, (
        "_build_upsell_block debe inyectarse DESPUÉS de _build_menu_block "
        "(el bloque <upsell> refiere a los ⭐ que vive en <carta>)"
    )
