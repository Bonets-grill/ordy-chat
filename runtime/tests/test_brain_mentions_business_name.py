"""Regresión: el bot debe mencionar el nombre del negocio en su respuesta
inicial (saludo, primera presentación) y cuando confirma una acción
clave (reserva, pedido, handoff). Si responde de forma genérica como un
chatbot anónimo, baja la percepción de "marca" y el validator nicho
da score bajo en menciona_negocio (observado 2/10 en Bonets Grill Icod
durante mega-sesión 2026-04-20).

El nombre vive en tenant.system_prompt (que se inyecta DESPUÉS del wrapper),
así que la hard_rule del wrapper NO puede citar un nombre concreto — solo
puede ordenar el comportamiento. Es exactamente el mismo patrón que la
hard_rule 8 (anti-sticky handoff): la conducta es genérica, los datos
los pone el tenant.

Estos tests son estructurales — no invocan a Claude. Verifican que la
hard_rule 9 existe y prohíbe respuestas anónimas. Si esta cláusula se
pierde en un refactor del wrapper, fallan antes de que el bug llegue a
producción.
"""

from __future__ import annotations

from app.prompt_wrapper import PROMPT_WRAPPER


def test_hard_rule_9_obliga_mencionar_nombre_del_negocio() -> None:
    """Existe una hard_rule numerada 9 que obliga a usar el nombre del
    negocio en momentos clave en lugar de responder de forma anónima.
    """
    p = PROMPT_WRAPPER
    # La rule 9 existe explícitamente.
    assert "\n9." in p, (
        "Falta hard_rule 9 sobre mencionar el nombre del negocio. "
        "Sin ella, el bot responde como un chatbot genérico y el "
        "validator marca menciona_negocio en score bajo."
    )
    low = p.lower()
    # Mensaje accionable: usa el nombre del negocio.
    assert "nombre del negocio" in low, (
        "La hard_rule 9 debe referirse explícitamente al 'nombre del negocio'."
    )


def test_hard_rule_9_prohibe_respuestas_genericas() -> None:
    """La rule debe prohibir saludos/confirmaciones que omiten el nombre
    del negocio (anti-anonimato).
    """
    low = PROMPT_WRAPPER.lower()
    # Prohibición explícita de respuestas genéricas/anónimas.
    assert "anónim" in low or "genéric" in low, (
        "La hard_rule 9 debe prohibir explícitamente respuestas anónimas/genéricas."
    )


def test_hard_rule_9_lista_momentos_clave() -> None:
    """La rule debe listar los momentos en los que el nombre es obligatorio:
    al menos saludo inicial y confirmación de acción (reserva/pedido/handoff).
    """
    low = PROMPT_WRAPPER.lower()
    # Saludo / primer turno.
    assert "saludo" in low or "primer" in low, (
        "La hard_rule 9 debe nombrar explícitamente el saludo/primer turno."
    )
    # Confirmaciones de acción.
    assert "confirma" in low and ("reserva" in low or "pedido" in low), (
        "La hard_rule 9 debe nombrar las confirmaciones de reserva/pedido."
    )


def test_hard_rule_9_no_cita_un_nombre_concreto() -> None:
    """El wrapper es genérico para todos los tenants. La rule NO debe
    contener un nombre concreto de negocio (Bonets, Pizza Roma, etc.) —
    el nombre real lo aporta tenant.system_prompt.
    """
    # Lista de tenants conocidos en el sistema. Si el wrapper menciona
    # alguno, es bug: el wrapper debe ser 100% genérico.
    nombres_concretos = ["bonets", "pizza roma", "el rincón", "la marina"]
    low = PROMPT_WRAPPER.lower()
    for n in nombres_concretos:
        assert n not in low, (
            f"El wrapper genérico no debe mencionar un nombre concreto: '{n}'. "
            "El nombre real vive en tenant.system_prompt."
        )
