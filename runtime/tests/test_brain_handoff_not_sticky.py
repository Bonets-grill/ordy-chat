"""Regresión: tras ejecutar solicitar_humano, el bot debe seguir atendiendo
preguntas factuales en turnos siguientes — no quedarse colgado en modo
"alguien te escribirá pronto".

Bug observado (2026-04-21 03:09 UTC+1, sesión playground Mario):

  Turn 1 cliente:  "Necesito hablar con una persona real, por favor"
  Turn 2 bot:      llama solicitar_humano + "Listo ✓ Ya he avisado..."
  Turn 3 cliente:  "¿A qué hora abrís hoy?"
  Turn 4 bot:      "Alguien del equipo te escribirá pronto. ¿Necesitas
                    algo más?"   ← BUG: ignora la pregunta de horario.

Causa identificada en runtime/app/brain.py TOOLS[solicitar_humano].description:
la instrucción "Después de llamar esta tool, dile al cliente que alguien
del equipo le escribirá pronto." la interpreta el modelo como sticky —
la repite en turnos siguientes en vez de responder la pregunta real.

Estos tests son estructurales — no invocan a Claude. Verifican que la
tool desc tiene cláusulas explícitas de "solo ese turno" + "sigue
atendiendo preguntas factuales". Si esas cláusulas se pierden en un
refactor, estos tests fallan antes de que el bug llegue a producción.
"""

from __future__ import annotations

from app.brain import TOOLS
from app.prompt_wrapper import PROMPT_WRAPPER


def _solicitar_humano_desc() -> str:
    tool = next(t for t in TOOLS if t["name"] == "solicitar_humano")
    return tool["description"]


def test_hard_rules_mandan_seguir_atendiendo_tras_handoff() -> None:
    """El wrapper debe tener una hard_rule explícita que obligue a seguir
    respondiendo preguntas factuales tras un handoff. La tool description
    sola no basta — el modelo la trata como guidance y no como ley. Las
    <hard_rules> son el mecanismo anti-regresión más fuerte del wrapper.
    """
    p = PROMPT_WRAPPER.lower()
    # La rule existe y es incondicional.
    assert "tras un handoff" in p or "tras el handoff" in p, (
        "Falta hard_rule explícita sobre comportamiento post-handoff"
    )
    # Menciona explícitamente que sigue atendiendo.
    assert "sigues atendiendo" in p or "sigue atendiendo" in p
    # Prohibición directa de respuesta sticky.
    assert "no contestes" in p and "alguien te escribirá" in p


def test_solicitar_humano_confirmacion_es_solo_ese_turno() -> None:
    """La instrucción 'dile que alguien le escribirá pronto' debe estar
    explícitamente acotada a ESE turno, no a la conversación entera.
    """
    desc = _solicitar_humano_desc().lower()
    # Señal explícita de que la confirmación es one-shot.
    assert (
        "solo en ese turno" in desc
        or "sólo en ese turno" in desc
        or "una sola vez" in desc
        or "no repitas" in desc
    ), (
        "Falta cláusula que acote la confirmación del handoff a ese turno. "
        "Sin ella, el modelo repite 'alguien te escribirá' en cada mensaje "
        "posterior e ignora las preguntas factuales del cliente."
    )


def test_solicitar_humano_manda_seguir_atendiendo_preguntas_factuales() -> None:
    """Tras el handoff, el bot debe seguir respondiendo preguntas simples
    (horario, carta, dirección, alergias) hasta que el humano tome relevo.
    """
    desc = _solicitar_humano_desc().lower()
    assert "preguntas factuales" in desc or (
        "sigue atendiendo" in desc and "horario" in desc
    ), (
        "Falta instrucción de seguir atendiendo preguntas factuales "
        "(horario/carta/dirección) en turnos posteriores al handoff."
    )


def test_solicitar_humano_no_sticky_reconfirmacion() -> None:
    """No debe haber instrucción de repetir el aviso del handoff en cada
    turno — eso es exactamente lo que causó el bug.
    """
    desc = _solicitar_humano_desc().lower()
    assert "recuerda cada vez" not in desc
    assert "repite en cada mensaje" not in desc
    assert "en todos los turnos" not in desc
