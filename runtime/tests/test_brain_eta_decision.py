"""Regresión: workflow Fase 6 — cliente acepta/rechaza ETA propuesto por cocina.

Verifica:
- Tool `responder_eta_pedido` registrada en brain.TOOLS con `accepted` required.
- Sandbox stub responde plausible para playground/validator.
- agent_tools.responder_eta_pedido ejecuta el SQL atómico que actualiza
  customer_eta_decision + status según corresponda.
- agent_tools.obtener_pedido_pendiente_eta tiene la query exacta que filtra
  el caso pending_kitchen_review + accepted + decision NULL.

Estructurales — no invocan a Claude ni tocan DB.
"""

from __future__ import annotations

import inspect
import json

from app import agent_tools, brain


def _eta_tool() -> dict:
    return next(t for t in brain.TOOLS if t["name"] == "responder_eta_pedido")


def test_responder_eta_pedido_existe_en_tools() -> None:
    tool = _eta_tool()
    schema = tool["input_schema"]
    assert schema.get("required") == ["accepted"], (
        "responder_eta_pedido debe requerir el campo 'accepted' (boolean)."
    )
    assert schema["properties"]["accepted"]["type"] == "boolean"


def test_sandbox_stub_responder_eta_pedido_acepta() -> None:
    raw = brain._sandbox_tool_stub("responder_eta_pedido", {"accepted": True})
    payload = json.loads(raw)
    assert payload["ok"] is True
    assert payload["status"] == "pending"
    assert payload["decision"] == "accepted"
    assert payload["sandbox"] is True


def test_sandbox_stub_responder_eta_pedido_rechaza() -> None:
    raw = brain._sandbox_tool_stub("responder_eta_pedido", {"accepted": False})
    payload = json.loads(raw)
    assert payload["ok"] is True
    assert payload["status"] == "canceled"
    assert payload["decision"] == "rejected"


def test_obtener_pedido_pendiente_eta_query_filtra_estado_correcto() -> None:
    """La query DEBE filtrar exactamente las 3 condiciones del workflow:
    status=pending_kitchen_review + kitchen_decision=accepted + customer_eta_decision IS NULL.
    Si alguna se afloja, el bloque se inyectaría en mensajes que no son
    respuesta a ETA — confundiendo al modelo.
    """
    src = inspect.getsource(agent_tools.obtener_pedido_pendiente_eta)
    assert "status = 'pending_kitchen_review'" in src
    assert "kitchen_decision = 'accepted'" in src
    assert "customer_eta_decision IS NULL" in src
    assert "ORDER BY created_at DESC" in src


def test_responder_eta_pedido_actualiza_status_segun_decision() -> None:
    """El UPDATE debe hacer status='pending' si accepted, 'canceled' si rejected.
    También el guard WHERE debe ser idéntico al de obtener_pedido_pendiente_eta
    para no actualizar orders fuera del estado correcto.
    """
    src = inspect.getsource(agent_tools.responder_eta_pedido)
    assert "WHEN $3 = 'accepted' THEN 'pending' ELSE 'canceled'" in src
    assert "status = 'pending_kitchen_review'" in src
    assert "kitchen_decision = 'accepted'" in src
    assert "customer_eta_decision IS NULL" in src


def test_brain_inyecta_bloque_pedido_pendiente_eta() -> None:
    """generar_respuesta debe construir el bloque <pedido_pendiente_eta>
    cuando el helper devuelve un pedido pendiente. Si esto desaparece, el
    modelo nunca sabrá cuándo llamar responder_eta_pedido.
    """
    src = inspect.getsource(brain.generar_respuesta)
    assert "<pedido_pendiente_eta>" in src, (
        "Falta inyección del bloque <pedido_pendiente_eta> en generar_respuesta."
    )
    assert "obtener_pedido_pendiente_eta" in src
    assert "responder_eta_pedido" in src
    # Sandbox/playground NO debe activar el bloque para no enredar tests.
    assert 'customer_phone != "playground-sandbox"' in src
