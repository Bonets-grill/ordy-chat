"""Regresión del system prompt de brain_admin.

Bug observado (2026-04-20 06:00, sesión Dakota):
  Admin dictó "desactiva la Dakota" → bot pidió "¿Confirmas?" → admin dijo
  "Si" → bot llamó `resumen_operativo_hoy` Y repitió la confirmación en vez
  de ejecutar `deshabilitar_item` directamente. Doble "Si" requerido.

Causa: dos reglas del system prompt interactuaban mal:
  - R2 (confirmación destructiva) no decía explícitamente "si ya te dijo sí,
    EJECUTA — no vuelvas a preguntar ni añadas contexto".
  - R final (saludo → resumen) se disparaba con cualquier apertura de turno,
    incluyendo un "Si" a una pregunta pendiente.

Estos tests son estructurales — no invocan a Claude. Verifican que las
cláusulas anti-regresión siguen en el prompt. Para la validación semántica
completa, ver `runtime/promptfoo/brain_admin.eval.yaml`.
"""

from __future__ import annotations

from app.brain_admin import ADMIN_SYSTEM_PROMPT


def test_prompt_prohibe_reconfirmar_tras_si() -> None:
    """Si el admin ya dijo sí, el LLM debe ejecutar — no volver a preguntar."""
    p = ADMIN_SYSTEM_PROMPT.lower()
    assert "ejecuta la tool inmediatamente" in p, (
        "Falta regla de ejecución inmediata tras confirmación afirmativa"
    )
    # Señales explícitas de que NO debe repetir la pregunta ni meter contexto.
    assert "no vuelvas a preguntar" in p
    assert "resumen_operativo_hoy" in p  # está mencionada en la negativa
    assert "no añadas información no pedida" in p


def test_prompt_saludo_resumen_limitado_a_apertura_fresca() -> None:
    """El resumen automático del día NO debe dispararse con 'sí' a confirmación."""
    p = ADMIN_SYSTEM_PROMPT.lower()
    # La regla de saludo debe condicionarse a conversación fresca.
    assert "conversación fresca" in p, (
        "El saludo→resumen debe estar scoped a apertura fresca, no a cualquier turno"
    )
    # Y rechazar explícitamente el disparo cuando admin responde sí/ok/dale.
    assert "no dispares el resumen si el admin está respondiendo" in p


def test_prompt_sigue_listando_afirmaciones_validas() -> None:
    """No se removió ningún sinónimo de confirmación al añadir la nueva regla."""
    p = ADMIN_SYSTEM_PROMPT.lower()
    for afirmacion in ("sí", "confirmo", "dale", "ok", "vale", "hazlo"):
        assert afirmacion in p, f"Falta '{afirmacion}' en la lista de afirmaciones"
