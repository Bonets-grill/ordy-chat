"""Regresión: los nombres de tools mencionados en prompt_wrapper.py deben
coincidir con los nombres reales registrados en brain.TOOLS. Si divergen,
el modelo intenta llamar tools inexistentes (silent fail) o ignora los
ejemplos como ruido.

Bug histórico (descubierto 2026-04-21):
- wrapper mencionaba `crear_cita` → la tool real es `agendar_cita`.
- wrapper mencionaba `crear_handoff` → la tool real es `solicitar_humano`.
- wrapper mencionaba `listar_citas_del_cliente` → la tool real es `mis_citas`.

Estos tests son estructurales — no invocan a Claude. Si alguien renombra
una tool en brain.py o añade un ejemplo con nombre fantasma al wrapper,
estos tests rompen antes de que el bug llegue a producción.
"""

from __future__ import annotations

import re

from app.brain import TOOLS
from app.prompt_wrapper import PROMPT_WRAPPER


def _real_tool_names() -> set[str]:
    return {t["name"] for t in TOOLS}


def _wrapper_tool_calls() -> set[str]:
    """Extrae los nombres invocados en <assistant_tool_call>NAME(...)</...>.
    No incluye menciones literales en texto narrativo (esas son referencias
    explicativas).
    """
    pattern = re.compile(r"<assistant_tool_call>([a-zA-Z_]+)\(")
    return set(pattern.findall(PROMPT_WRAPPER))


def test_todos_los_assistant_tool_call_existen_en_brain() -> None:
    """Cada nombre que aparece como <assistant_tool_call>NAME(...) debe
    estar registrado en brain.TOOLS. Si falla, el modelo aprende del
    ejemplo a llamar una tool fantasma que falla en runtime.
    """
    real = _real_tool_names()
    invoked = _wrapper_tool_calls()
    missing = invoked - real
    assert not missing, (
        f"El wrapper invoca tools que NO existen en brain.TOOLS: {missing}. "
        f"Tools reales disponibles: {sorted(real)}. "
        f"Renombra los ejemplos del wrapper o registra las tools en brain."
    )


def test_nombres_fantasma_historicos_no_reaparecen() -> None:
    """Lista negra de nombres que existieron históricamente como ejemplos
    falsos en el wrapper. No deben volver a aparecer (ni en ejemplos ni
    en bloques narrativos del tool_guide).
    """
    fantasmas = ["crear_cita", "crear_handoff", "listar_citas_del_cliente"]
    real = _real_tool_names()
    # Sanity check: ninguno está en TOOLS reales.
    for f in fantasmas:
        assert f not in real, (
            f"'{f}' está en brain.TOOLS — actualiza la lista negra del test."
        )
    # Y ninguno aparece en el wrapper.
    for f in fantasmas:
        assert f not in PROMPT_WRAPPER, (
            f"'{f}' reaparece en prompt_wrapper.py. Es un nombre fantasma "
            f"que no existe en brain.TOOLS — usar el nombre real."
        )


def test_tools_clave_de_negocio_estan_documentadas_en_wrapper() -> None:
    """Las tools que el bot usa con clientes (no las admin) deben tener
    ALGUNA mención en el wrapper para que el modelo aprenda cuándo
    invocarlas. Si una tool nueva entra en brain.TOOLS sin docs en el
    wrapper, este test la detecta.
    """
    tools_cliente = {"agendar_cita", "crear_pedido", "mis_citas", "solicitar_humano"}
    real = _real_tool_names()
    # Las 4 deben existir realmente.
    for t in tools_cliente:
        assert t in real, f"Tool de negocio esperada no existe en brain.TOOLS: {t}"
    # Y deben estar mencionadas en el wrapper.
    for t in tools_cliente:
        assert t in PROMPT_WRAPPER, (
            f"Tool '{t}' existe en brain.TOOLS pero no se menciona en "
            f"prompt_wrapper.py — el modelo no sabrá cuándo usarla."
        )
