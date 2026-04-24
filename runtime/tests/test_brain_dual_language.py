"""Regresión: el bot debe responder SIEMPRE en el mismo idioma en el que
el cliente le escribe. La presentación comercial de Ordy Chat promete
"Ordy habla cualquier idioma que le hable el cliente" (cliente inglés,
francés, alemán → el bot contesta en ese idioma sin que el dueño mueva
un dedo).

Antes de esta regla, el idioma del cliente estaba cubierto solo como
rule #5 a media lista de hard_rules. Claude por defecto replicaría el
idioma del input, pero no había:
- Regla explícita como GATE maestro que se evalúe ANTES que cualquier
  otra (idioma condiciona todo lo demás).
- Instrucción explícita de NO traducir los nombres de platos de la
  carta (son nombres propios — "Dacoka Burger" se queda así aunque
  respondas en inglés).
- Tests que verificaran que el system prompt enviado a Claude contiene
  la regla de idioma para inputs en EN/FR/ES.

Esta suite es estructural (no invoca a Claude). Verifica que la rule 0
existe, va al principio del bloque hard_rules, y que el wrapper la
incluye en el system prompt resultante independientemente del prompt
del tenant. Si esta cláusula se pierde en un refactor, rompe antes de
llegar a producción.
"""

from __future__ import annotations

from app.prompt_wrapper import PROMPT_WRAPPER, wrap


# ── Estructura del wrapper ──────────────────────────────────────────


def test_hard_rule_0_idioma_cliente_existe_al_principio() -> None:
    """Existe una hard_rule numerada 0 sobre idioma del cliente y aparece
    ANTES de la hard_rule 1 (no-inventar). Rule 0 = GATE maestro que se
    evalúa antes que el resto.
    """
    p = PROMPT_WRAPPER
    assert "\n0. IDIOMA DEL CLIENTE" in p, (
        "Falta hard_rule 0 'IDIOMA DEL CLIENTE' como primera regla. "
        "Sin ella, el bot puede responder en español aunque el cliente "
        "escriba en inglés/francés/alemán."
    )
    idx_r0 = p.index("\n0. IDIOMA DEL CLIENTE")
    idx_r1 = p.index("\n1. NO INVENTES")
    assert idx_r0 < idx_r1, (
        "La hard_rule 0 de idioma debe aparecer ANTES que la rule 1. "
        "Es el gate maestro: condiciona cómo se expresan todas las demás."
    )


def test_hard_rule_0_menciona_idiomas_concretos() -> None:
    """La regla debe listar al menos inglés y francés explícitamente para
    que Claude no dude en idiomas comunes de turismo en España.
    """
    low = PROMPT_WRAPPER.lower()
    assert "inglés" in low, "La rule de idioma debe mencionar inglés explícitamente."
    assert "francés" in low, "La rule de idioma debe mencionar francés explícitamente."


def test_hard_rule_0_prohibe_traducir_carta() -> None:
    """Los nombres de platos son nombres propios — NO se traducen al cambiar
    de idioma. 'Dacoka Burger' se queda 'Dacoka Burger' aunque respondas
    en inglés.
    """
    low = PROMPT_WRAPPER.lower()
    assert "no traduzcas" in low and "carta" in low, (
        "La rule 0 debe prohibir explícitamente traducir los nombres "
        "de los platos / contenido de la carta."
    )


def test_hard_rule_0_maneja_mezcla_de_idiomas() -> None:
    """Si el cliente mezcla idiomas en un mensaje, la regla debe indicar
    qué hacer (usar el predominante) — sin esto, el modelo puede
    oscilar turno a turno.
    """
    low = PROMPT_WRAPPER.lower()
    assert "mezcla" in low and "predominante" in low, (
        "La rule 0 debe resolver el caso de mezcla de idiomas con regla "
        "clara (usar el predominante)."
    )


# ── wrap() entrega la rule en el system prompt enviado a Claude ─────


def _fake_tenant_prompt() -> str:
    """Simula un prompt de tenant genérico (el wrapper debe funcionar
    con cualquier contenido de tenant — no debe depender de él).
    """
    return (
        "Eres el asistente de El Mesón de Pepe, restaurante en Madrid.\n"
        "Carta: tortilla española 8€, croquetas 6€.\n"
    )


def test_wrap_incluye_rule_idioma_para_input_ingles() -> None:
    """Simula el flujo brain.py: el system prompt que recibe Claude cuando
    el cliente escribe en inglés contiene la rule 0 de idioma.
    Aunque el input sea EN, la regla siempre viaja en el system prompt
    (el system prompt no depende del mensaje del cliente).
    """
    # Input simulado del cliente en inglés.
    customer_input = "Hello, do you have a table for 4 at 9 pm?"
    # El wrapper se invoca en brain.py independientemente del idioma
    # del input; la regla debe estar presente siempre.
    system_prompt = wrap(_fake_tenant_prompt())
    assert "0. IDIOMA DEL CLIENTE" in system_prompt, (
        f"System prompt enviado a Claude para input '{customer_input}' "
        "no contiene la rule 0 de idioma."
    )
    # El prompt del tenant también debe seguir presente (wrapper no
    # reemplaza, solo antepone).
    assert "El Mesón de Pepe" in system_prompt


def test_wrap_incluye_rule_idioma_para_input_frances() -> None:
    """Idem para cliente que escribe en francés."""
    customer_input = "Bonjour, avez-vous une table pour 4?"
    system_prompt = wrap(_fake_tenant_prompt())
    assert "0. IDIOMA DEL CLIENTE" in system_prompt, (
        f"System prompt para input '{customer_input}' no contiene la "
        "rule 0 de idioma."
    )
    # Verifica también que menciona francés por nombre (clave para que
    # el modelo no dude con un acento o un "bonjour" aislado).
    assert "francés" in system_prompt.lower()


def test_wrap_incluye_rule_idioma_para_input_espanol() -> None:
    """Cliente en español — el default. La regla también debe estar
    presente para que el bot sepa que debe MANTENER español (no saltar
    a inglés por ruido del prompt del tenant o ejemplos EN).
    """
    customer_input = "Hola, tenéis mesa?"
    system_prompt = wrap(_fake_tenant_prompt())
    assert "0. IDIOMA DEL CLIENTE" in system_prompt, (
        f"System prompt para input '{customer_input}' no contiene la "
        "rule 0 de idioma."
    )
    # El default explícito.
    assert "mismo idioma" in system_prompt.lower()
