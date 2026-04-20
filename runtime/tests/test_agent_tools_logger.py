"""Regresión del bug P0 2026-04-20 22:00: agent_tools.py sin logger.

Síntoma observado en prod (Bonets Grill):
  Cliente pide modificar un pedido → bot responde "Vaya, ha habido un
  problema técnico al intentar contactar con el equipo. Te recomiendo
  que les escribas directamente o llames al local…"

Causa raíz:
  `agent_tools.crear_handoff` tenía `logger.info(...)` y
  `logger.exception(...)` dentro del bloque de notificación WA al
  humano del tenant, pero el módulo NO importaba `logging` ni definía
  `logger`. Resultado: cada ejecución de `solicitar_humano` en un
  tenant con `handoff_whatsapp_phone` configurado levantaba NameError
  DESPUÉS de insertar correctamente la fila en `handoff_requests`,
  propagaba hasta `brain._ejecutar_tool`, que devolvía
  `{"ok": False, "error": "name 'logger' is not defined"}` al modelo,
  y Claude inventaba la frase "problema técnico".

El bug estaba latente desde que se añadió el bloque de notificación
(commit 8d7db6d) y se disparó al poblar `agent_configs.handoff_whatsapp_phone`.

Este test fuerza el uso de logger (import + nombre) para que si alguien
vuelve a borrarlo, pytest falle antes de merge.
"""

from __future__ import annotations

import logging

from app import agent_tools


def test_agent_tools_define_logger() -> None:
    assert hasattr(agent_tools, "logger"), (
        "agent_tools.py DEBE definir `logger` — el bloque de notificación WA "
        "lo usa dentro de try/except y sin él toda llamada a solicitar_humano "
        "se devuelve al modelo como ok:false."
    )
    assert isinstance(agent_tools.logger, logging.Logger)
    assert agent_tools.logger.name == "ordychat.agent_tools"


def test_agent_tools_logger_usable_sin_excepcion() -> None:
    """Llama las APIs mínimas del logger que agent_tools invoca."""
    # No queremos ruido en los tests, pero sí verificar que no levantan.
    agent_tools.logger.info("regresion_test_info")
    try:
        raise RuntimeError("simulated")
    except RuntimeError:
        agent_tools.logger.exception("regresion_test_exception")
