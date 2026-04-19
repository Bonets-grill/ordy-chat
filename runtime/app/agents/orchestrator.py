# runtime/app/agents/orchestrator.py
# Orchestrator determinístico (NO LLM, AI Eng review F2).
# Flujo: router keywords → enabled_agents del tenant → focus_block.
# El focus_block se inyecta al system_prompt de brain.py para guiar a Claude
# sobre qué intents priorizar. No reemplaza brain.py — lo enriquece.

from __future__ import annotations

import logging
from typing import Any
from uuid import UUID, uuid4

import asyncpg

from app.agents.router import AgentName, route

logger = logging.getLogger("ordychat.orchestrator")


_ADD_ON_LABEL: dict[str, str] = {
    "reservas": "Reservas",
    "pedidos": "Pedidos (takeaway + entrega)",
    "kds": "KDS cocina/bar (estado de pedidos)",
    "pos": "POS / Facturación Verifactu",
    "webchat": "Webchat web",
    "base": "Carta, horarios, FAQ, alergias, maridajes",
}


async def get_tenant_add_ons(pool: asyncpg.Pool, tenant_id: UUID) -> dict[str, Any] | None:
    """Lee tenant_add_ons de DB. Devuelve None si no existe fila."""
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """SELECT multi_agent_enabled, reservas_enabled, pedidos_enabled,
                      kds_enabled, pos_enabled, webchat_enabled, disabled_agents
               FROM tenant_add_ons WHERE tenant_id = $1""",
            tenant_id,
        )
    return dict(row) if row else None


def build_enabled_set(row: dict[str, Any]) -> set[AgentName]:
    """Convierte row tenant_add_ons en set de agentes activos."""
    enabled: set[AgentName] = {"base"}
    if row.get("reservas_enabled"):
        enabled.add("reservas")
    if row.get("pedidos_enabled"):
        enabled.add("pedidos")
    if row.get("kds_enabled"):
        enabled.add("kds")
    if row.get("pos_enabled"):
        enabled.add("pos")
    disabled = set(row.get("disabled_agents") or [])
    return enabled - disabled


def build_focus_block(
    text: str,
    enabled: set[AgentName],
) -> str:
    """
    Construye bloque XML con add-ons activos + intents detectados + guía.
    Se inyecta al system_prompt como último bloque (mayor prioridad).
    """
    intents = route(text, enabled)
    addon_lines = [f"  - {_ADD_ON_LABEL[a]}" for a in sorted(enabled) if a in _ADD_ON_LABEL]
    intent_lines = [f"  - {_ADD_ON_LABEL.get(i, i)}" for i in intents]

    return "\n".join([
        "<orchestrator>",
        "Este tenant tiene estos add-ons ACTIVOS (puedes resolver con sus tools):",
        *addon_lines,
        "",
        "Análisis del mensaje actual sugiere priorizar:",
        *intent_lines,
        "",
        "Reglas del orchestrator:",
        "1. Resuelve los intents priorizados con las tools correspondientes en orden.",
        "2. Si un intent pide un add-on NO activo (p.ej. cliente pide factura pero POS",
        "   no está activo): responde amablemente que ese servicio no está disponible",
        "   aquí y ofrece alternativa (ej: 'puedo apuntar tu pedido pero la factura te",
        "   la damos en el local').",
        "3. Si es multi-intent (reserva + pedido), resuelve UNA tool a la vez y confirma",
        "   antes de la siguiente. NO llames 2 tools en la misma respuesta.",
        "4. El agente 'base' cubre lo que no tiene tool: carta, horarios, maridajes,",
        "   alergias, FAQ general — responde directo sin tool.",
        "</orchestrator>",
    ])


async def log_invocation(
    pool: asyncpg.Pool,
    *,
    tenant_id: UUID,
    conversation_id: UUID | None,
    trace_id: UUID,
    agent_name: str,
    input_text: str | None,
    output_text: str | None,
    model: str,
    latency_ms: int,
    tokens_input: int,
    tokens_output: int,
    status: str = "success",
    error: str | None = None,
) -> None:
    """Persiste un trace de invocación. Non-blocking — si falla, solo log."""
    try:
        async with pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO agent_invocations
                   (tenant_id, conversation_id, trace_id, agent_name, input_text,
                    output_text, model, latency_ms, tokens_input, tokens_output, status, error)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)""",
                tenant_id, conversation_id, trace_id, agent_name,
                input_text, output_text, model, latency_ms,
                tokens_input, tokens_output, status, error,
            )
    except Exception:
        logger.exception("agent_invocations insert falló", extra={"trace_id": str(trace_id)})


def new_trace_id() -> UUID:
    return uuid4()
