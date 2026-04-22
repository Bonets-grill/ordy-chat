"""Regresión: mensajes cortos (1 char) NO deben caer en fallback inmediato.

Bug observado 2026-04-22 en playground Bonets:
  Bot: "¡Genial! ¿Cuántas hamburguesas son?"
  Cliente: "1"
  Bot: "Disculpa, no entendí tu mensaje. ¿Podrías reformularlo?"

Causa: brain.py:598 tenía `if len(texto_limpio) < 2: return fallback`. Eso
descartaba "1", "2", "3", "a", "b" — todas son respuestas válidas en multi-turn
("¿cuántas?" → "1"; "¿qué letra del menú?" → "a"; etc.).

Fix: ahora solo descartamos texto VACÍO. Mensajes ≥ 1 char van al LLM.

Estos tests son estructurales — no invocan a Claude. Verifican el guard
exacto en `generar_respuesta`. Si alguien sube de nuevo el threshold a >= 2
en un refactor, el test rompe antes de prod.
"""

from __future__ import annotations

import inspect

from app import brain


def test_guard_solo_descarta_texto_vacio() -> None:
    """El source de generar_respuesta debe contener el guard `len(...) == 0`
    (texto vacío) y NO el viejo `< 2` que rompía respuestas de 1 char.
    """
    src = inspect.getsource(brain.generar_respuesta)
    # Estado correcto post-fix: == 0.
    assert "len(texto_limpio) == 0" in src, (
        "Falta el guard `len(texto_limpio) == 0` que rechaza solo texto vacío. "
        "Si lo sustituiste por `< N` (N>0), bloquearás respuestas válidas como '1', '2', 'a'."
    )
    # Estado incorrecto histórico: < 2 (rechaza '1').
    assert "len(texto_limpio) < 2" not in src, (
        "Reintroducido el guard `len(texto_limpio) < 2`. Eso rechaza '1', '2', 'a' — "
        "respuestas válidas en multi-turn (ver bug 2026-04-22 playground Bonets)."
    )


def test_threshold_solo_caracteres_es_1_char_o_mas() -> None:
    """Concretamente: cualquier guard de longitud en este path debe permitir
    mensajes de 1 carácter como mínimo. Si en el futuro alguien añade
    sanitización adicional (`< 1`, `< 2`, etc.) que filtre 1-char, el bot
    volverá a fallar respuestas tipo '1'.
    """
    src = inspect.getsource(brain.generar_respuesta)
    # Esta lista cubre las variantes que históricamente han roto este caso.
    bad_patterns = [
        "len(texto_limpio) < 2",
        "len(texto_limpio) < 3",
        "len(texto_limpio) <= 1",
        "len(texto_limpio) <= 2",
    ]
    for pat in bad_patterns:
        assert pat not in src, (
            f"Patrón prohibido en generar_respuesta: `{pat}`. "
            f"Bloquea respuestas válidas de 1 carácter ('1', 'a', etc)."
        )
