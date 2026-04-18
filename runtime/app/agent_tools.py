# runtime/app/agent_tools.py — Operaciones de DB que invoca Claude como tools.
#
# Objetivo: que el bot DEJE DE MENTIR. Antes decía "tu cita queda agendada" sin
# guardar nada. Ahora cada tool persiste el evento en Postgres con tenant_id.

from datetime import datetime
from typing import Any
from uuid import UUID

from app.memory import inicializar_pool


async def crear_cita(
    tenant_id: UUID,
    customer_phone: str,
    starts_at_iso: str,
    title: str,
    duration_min: int = 30,
    customer_name: str | None = None,
    notes: str | None = None,
) -> dict[str, Any]:
    """
    Guarda una cita/reserva. `starts_at_iso` formato ISO-8601 (ej: 2026-04-20T13:30:00+02:00).
    Devuelve {ok, appointment_id, starts_at_iso}.
    """
    try:
        starts_at = datetime.fromisoformat(starts_at_iso)
    except Exception:
        return {"ok": False, "error": f"fecha_inválida: '{starts_at_iso}'. Usa ISO-8601 (YYYY-MM-DDTHH:MM:SS+TZ)"}
    if duration_min <= 0 or duration_min > 24 * 60:
        return {"ok": False, "error": "duration_min inválido"}
    if not title or len(title.strip()) < 2:
        return {"ok": False, "error": "title requerido"}

    pool = await inicializar_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO appointments
              (tenant_id, customer_phone, customer_name, starts_at, duration_min, title, notes)
            VALUES ($1,$2,$3,$4,$5,$6,$7)
            RETURNING id, starts_at
            """,
            tenant_id, customer_phone, customer_name, starts_at, duration_min, title.strip(), notes,
        )
    return {
        "ok": True,
        "appointment_id": str(row["id"]),
        "starts_at_iso": row["starts_at"].isoformat(),
        "duration_min": duration_min,
        "title": title.strip(),
    }


async def crear_handoff(
    tenant_id: UUID,
    customer_phone: str,
    reason: str,
    priority: str = "normal",
    customer_name: str | None = None,
    conversation_id: UUID | None = None,
) -> dict[str, Any]:
    """Registra solicitud de humano. El owner la verá en dashboard + (futuro) recibirá email/push."""
    if priority not in ("low", "normal", "urgent"):
        priority = "normal"
    if not reason or len(reason.strip()) < 3:
        return {"ok": False, "error": "reason requerido (min 3 chars)"}

    pool = await inicializar_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO handoff_requests
              (tenant_id, conversation_id, customer_phone, customer_name, reason, priority)
            VALUES ($1,$2,$3,$4,$5,$6)
            RETURNING id, created_at
            """,
            tenant_id, conversation_id, customer_phone, customer_name, reason.strip(), priority,
        )
    return {
        "ok": True,
        "handoff_id": str(row["id"]),
        "priority": priority,
        "reason": reason.strip(),
    }


async def listar_citas_del_cliente(
    tenant_id: UUID, customer_phone: str, limit: int = 5
) -> list[dict[str, Any]]:
    """Para que Claude pueda informar al cliente de sus próximas citas."""
    pool = await inicializar_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, starts_at, duration_min, title, status
            FROM appointments
            WHERE tenant_id = $1 AND customer_phone = $2
              AND starts_at > now() - interval '1 day'
            ORDER BY starts_at ASC
            LIMIT $3
            """,
            tenant_id, customer_phone, limit,
        )
    return [
        {
            "id": str(r["id"]),
            "starts_at_iso": r["starts_at"].isoformat(),
            "duration_min": r["duration_min"],
            "title": r["title"],
            "status": r["status"],
        }
        for r in rows
    ]
