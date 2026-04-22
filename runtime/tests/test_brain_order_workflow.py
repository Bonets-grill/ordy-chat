"""Regresión: workflow robusto cocina ↔ cliente (mig 027).

Verifica:
- Tool crear_pedido REQUIERE order_type ('dine_in'|'takeaway') en su input_schema.
- Hard_rule 10 en wrapper instruye al bot a preguntar tipo + mesa/nombre antes.
- Hard_rule 11 instruye fuzzy match de productos (Dakota → Dacoka).
- crear_pedido no menciona obtener_link_pago — el pago va a Fase 6.

Estructurales — no invocan a Claude.
"""

from __future__ import annotations

import inspect

from app import brain
from app.prompt_wrapper import PROMPT_WRAPPER


def _crear_pedido_tool() -> dict:
    return next(t for t in brain.TOOLS if t["name"] == "crear_pedido")


def test_crear_pedido_requiere_order_type() -> None:
    tool = _crear_pedido_tool()
    schema = tool["input_schema"]
    required = schema.get("required", [])
    assert "order_type" in required, (
        "order_type debe ser required en input_schema de crear_pedido. "
        "Sin esto el modelo puede crear pedidos sin saber si es comer-aquí o llevar."
    )
    enum_vals = schema["properties"]["order_type"].get("enum", [])
    assert set(enum_vals) == {"dine_in", "takeaway"}, (
        f"order_type enum debe ser exactamente ['dine_in','takeaway'], es {enum_vals}"
    )


def test_crear_pedido_documenta_table_number_y_customer_name_condicionales() -> None:
    tool = _crear_pedido_tool()
    props = tool["input_schema"]["properties"]
    table_desc = props["table_number"]["description"].lower()
    name_desc = props["customer_name"]["description"].lower()
    assert "dine_in" in table_desc or "comer aqu" in table_desc, (
        "table_number description debe mencionar dine_in/comer aquí explícitamente."
    )
    assert "takeaway" in name_desc or "llevar" in name_desc, (
        "customer_name description debe mencionar takeaway/llevar explícitamente."
    )


def test_brain_handler_skipea_obtener_link_pago_en_pending_kitchen_review() -> None:
    """El handler de crear_pedido en brain.py NO debe llamar obtener_link_pago
    en el flujo nuevo. El pago se ofrece después de que cocina acepte y el
    cliente confirme el ETA (Fase 6)."""
    # Leemos el bloque del handler (entre `if tool_name == "crear_pedido":` y el siguiente if).
    src = inspect.getsource(brain._ejecutar_tool) if hasattr(brain, "_ejecutar_tool") else inspect.getsource(brain.generar_respuesta)
    # Localizamos el bloque del handler.
    start = src.find('if tool_name == "crear_pedido"')
    assert start >= 0, "no encontré el handler de crear_pedido en brain"
    # El bloque cerca del handler NO debe tener obtener_link_pago.
    # Tomamos hasta el siguiente "if tool_name ==" como bound del bloque.
    rest = src[start:]
    next_if = rest.find('if tool_name ==', 30)
    bloque = rest[:next_if] if next_if > 0 else rest[:1500]
    assert "obtener_link_pago" not in bloque, (
        "El handler de crear_pedido NO debe llamar obtener_link_pago — el pago "
        "se ofrece tras cocina-acepta + cliente-confirma-ETA (Fase 6)."
    )
    # Pero SÍ debe hacer mención al envío a cocina.
    assert "cocina" in bloque.lower() or "pending_kitchen_review" in bloque, (
        "El handler debe instruir al bot a decir 'enviado a cocina', no 'confirmado'."
    )


def test_hard_rule_10_pedidos_pregunta_tipo_y_mesa_o_nombre() -> None:
    p = PROMPT_WRAPPER
    assert "\n10." in p, "Falta hard_rule 10 sobre el flujo de pedidos."
    low = p.lower()
    # Debe nombrar las 3 piezas: tipo, mesa, nombre.
    assert "comer aqu" in low or "dine_in" in low, "rule 10 debe nombrar comer aquí/dine_in"
    assert "llevar" in low or "takeaway" in low, "rule 10 debe nombrar llevar/takeaway"
    assert "mesa" in low and "nombre" in low, "rule 10 debe nombrar mesa Y nombre"
    # Debe prohibir "pedido confirmado" tras crear_pedido.
    assert "enviado a cocina" in low, (
        "rule 10 debe instruir 'pedido enviado a cocina' en vez de 'confirmado'."
    )


def test_hard_rule_11_fuzzy_match_carta() -> None:
    p = PROMPT_WRAPPER
    assert "\n11." in p, "Falta hard_rule 11 sobre fuzzy match de carta."
    low = p.lower()
    # Debe nombrar el caso Dakota/Dacoka como ejemplo o el concepto fuzzy.
    assert "dakota" in low or "dacoka" in low or "typo" in low or "similaridad" in low, (
        "rule 11 debe ejemplificar el fuzzy match (Dakota/Dacoka) o nombrar typos."
    )
    # Debe prohibir respuesta literal "no tengo ese plato" cuando hay match.
    assert "no tengo" in low or "no encuentro" in low, (
        "rule 11 debe nombrar las respuestas literales prohibidas."
    )
