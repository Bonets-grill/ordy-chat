# runtime/app/agents/router.py
# Clasificador multi-label por KEYWORDS (no LLM).
# AI Eng review F2: evita SPoF + latencia + coste del router LLM.
# Para 90%+ del tráfico hostelero, keywords son suficiente y 0ms.
# Si falta precisión → upgrade a Haiku tool-use en v2.

from __future__ import annotations

from typing import Literal

AgentName = Literal["base", "reservas", "pedidos", "kds", "pos"]

# Keywords → intent. Lowercased match. Multi-label: un mensaje puede matchear varios.
_KEYWORDS: dict[AgentName, tuple[str, ...]] = {
    "reservas": (
        "reserv", "mesa para", "mesa el", "tengo mesa", "cita",
        "anular reserva", "cambiar reserva", "modificar reserva",
    ),
    "pedidos": (
        "pedir", "pedido", "pido", "llevar", "takeaway", "para recoger",
        "domicilio", "entrega", "delivery", "encargar", "comanda",
    ),
    "kds": (
        "está listo", "ya está mi pedido", "cuánto falta", "cuánto tarda",
        "mi comida ya", "mi pedido ya",
    ),
    "pos": (
        "factura", "recibo con nif", "facturar", "cobrar", "pagar", "link de pago",
    ),
}


def route(text: str, enabled_agents: set[AgentName]) -> list[AgentName]:
    """
    Clasifica intents del mensaje. Devuelve lista de agentes a invocar.
    - Siempre incluye 'base' al final (fallback seguro: FAQ/carta/horarios).
    - Filtra por enabled_agents del tenant (no dispara agentes desactivados).
    - Multi-label: "quiero reservar y pedir" → [reservas, pedidos, base].
    """
    t = (text or "").lower()
    matched: list[AgentName] = []
    for agent, kws in _KEYWORDS.items():
        if agent not in enabled_agents:
            continue
        if any(kw in t for kw in kws):
            matched.append(agent)
    # Base siempre incluido como último (sabe de carta/horarios/FAQ).
    if "base" in enabled_agents and "base" not in matched:
        matched.append("base")
    return matched or ["base"]
