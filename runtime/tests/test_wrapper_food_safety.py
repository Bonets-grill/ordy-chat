"""Tests de la regla 12 (seguridad alimentaria — hamburguesa poco hecha).

Mario 2026-04-24: "cuando el cliente elige poco hecha debe salir con
emojis un texto de salud, indicando que la carne de hamburguesa poco
hecha no es recomendable y explicar porqué".

Este test verifica que el wrapper del prompt contiene la regla con
el contenido esperado. El prompt lo lee el modelo y aplica la regla
cuando detecta "poco hecha" / "cruda" / "rare" en el turno.
"""

from __future__ import annotations

from app.prompt_wrapper import PROMPT_WRAPPER


def test_regla_12_hamburguesa_poco_hecha_presente() -> None:
    assert "12. SEGURIDAD ALIMENTARIA" in PROMPT_WRAPPER
    assert "poco hecha" in PROMPT_WRAPPER


def test_regla_12_lista_triggers() -> None:
    # El modelo debe disparar con varias expresiones del cliente.
    triggers = ["poco hecha", "cruda", "sangrante", "rare", "al punto bajo"]
    for t in triggers:
        assert t in PROMPT_WRAPPER, f"trigger faltante: {t}"


def test_regla_12_contiene_explicacion_sanitaria() -> None:
    assert "E. coli" in PROMPT_WRAPPER
    assert "salmonella" in PROMPT_WRAPPER
    assert "carne picada" in PROMPT_WRAPPER
    assert "70°C" in PROMPT_WRAPPER


def test_regla_12_tiene_emojis() -> None:
    assert "⚠️" in PROMPT_WRAPPER
    assert "🥩" in PROMPT_WRAPPER
    assert "🦠" in PROMPT_WRAPPER


def test_regla_12_no_bloquea_pedido_si_cliente_insiste() -> None:
    # La política es avisar UNA vez; si el cliente insiste, aceptar
    # y añadir nota "advertido cliente". No moralizar repetidamente.
    assert "Si el cliente insiste" in PROMPT_WRAPPER
    assert "advertido cliente" in PROMPT_WRAPPER
    assert "NO bloquees el pedido" in PROMPT_WRAPPER


def test_regla_12_solo_aplica_a_hamburguesa() -> None:
    # Un filete poco hecho (steak) NO dispara este aviso — sólo burger.
    assert "sólo a hamburguesa" in PROMPT_WRAPPER
