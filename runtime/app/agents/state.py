# runtime/app/agents/state.py
# Contexto conversacional compartido entre agentes.
# Slots por agente: cada agente lee/escribe su slot; orchestrator expone todo.

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any
from uuid import UUID


@dataclass
class ConversationState:
    tenant_id: UUID
    customer_phone: str | None
    trace_id: UUID
    enabled_agents: set[str]
    slots: dict[str, Any] = field(default_factory=dict)

    def get_slot(self, agent: str, key: str, default: Any = None) -> Any:
        return self.slots.get(f"{agent}.{key}", default)

    def set_slot(self, agent: str, key: str, value: Any) -> None:
        self.slots[f"{agent}.{key}"] = value

    def summary(self) -> str:
        """Resumen plano para compartir con agentes (no incluye todo el slot tree)."""
        if not self.slots:
            return ""
        lines = ["<estado>"]
        for k, v in self.slots.items():
            lines.append(f"  {k}: {str(v)[:100]}")
        lines.append("</estado>")
        return "\n".join(lines)
