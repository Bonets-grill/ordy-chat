# runtime/app/agent_tools.py — Operaciones de DB que invoca Claude como tools.
#
# Objetivo: que el bot DEJE DE MENTIR. Antes decía "tu cita queda agendada" sin
# guardar nada. Ahora cada tool persiste el evento en Postgres con tenant_id.

import logging
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID
from zoneinfo import ZoneInfo

from app.memory import inicializar_pool

logger = logging.getLogger("ordychat.agent_tools")

# Máximo horizonte de reserva: 90 días. Más allá casi siempre es modelo que
# confabuló un año equivocado (observado: 2027 en lugar de 2026).
_MAX_FUTURE_DAYS = 90


async def crear_cita(
    tenant_id: UUID,
    customer_phone: str,
    starts_at_iso: str,
    title: str,
    duration_min: int = 30,
    customer_name: str | None = None,
    notes: str | None = None,
    closed_for: list[str] | None = None,
    tenant_timezone: str = "Europe/Madrid",
) -> dict[str, Any]:
    """
    Guarda una cita/reserva. `starts_at_iso` formato ISO-8601 (ej: 2026-04-20T13:30:00+02:00).
    Devuelve {ok, appointment_id, starts_at_iso}.

    Guard server-side: rechaza fechas en pasado o >90 días futuro. No valida
    horario del negocio (eso vive en el system prompt dinámico vía
    `tenants.schedule`).

    Double-guard contra `reservations_closed_for` (migración 015): aunque el
    system_prompt ya incluye la regla de días cerrados, este guard rechaza
    a nivel DB si el modelo la ignorara. La fecha se compara en la TZ del
    tenant para que "cerrado el 20" se aplique a todo el día local del negocio.
    """
    try:
        starts_at = datetime.fromisoformat(starts_at_iso)
    except Exception:
        return {"ok": False, "error": f"fecha_inválida: '{starts_at_iso}'. Usa ISO-8601 (YYYY-MM-DDTHH:MM:SS+TZ)"}
    if starts_at.tzinfo is None:
        # Asumimos UTC solo para la comparación — el cliente debería enviar tz.
        starts_at = starts_at.replace(tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)
    if starts_at < now - timedelta(minutes=5):
        return {
            "ok": False,
            "error": "fecha_en_pasado",
            "hint": "Esa fecha ya pasó. Pregunta al cliente por un día/hora futura.",
        }
    if starts_at > now + timedelta(days=_MAX_FUTURE_DAYS):
        return {
            "ok": False,
            "error": "fecha_demasiado_lejana",
            "hint": f"Solo aceptamos reservas en los próximos {_MAX_FUTURE_DAYS} días. Verifica el AÑO con el cliente — probablemente quiso decir {now.year} y no {starts_at.year}.",
        }
    if duration_min <= 0 or duration_min > 24 * 60:
        return {"ok": False, "error": "duration_min inválido"}
    if not title or len(title.strip()) < 2:
        return {"ok": False, "error": "title requerido"}

    if closed_for:
        try:
            tz = ZoneInfo(tenant_timezone)
        except Exception:
            tz = ZoneInfo("Europe/Madrid")
        local_date_iso = starts_at.astimezone(tz).date().isoformat()
        if local_date_iso in closed_for:
            return {
                "ok": False,
                "error": "fecha_no_disponible",
                "hint": (
                    f"Ese día ({local_date_iso}) el negocio no acepta reservas. "
                    "Discúlpate con el cliente y ofrece otro día disponible."
                ),
            }

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
    """Registra solicitud de humano + manda WhatsApp al teléfono humano que
    el tenant configuró en agent_configs.handoff_whatsapp_phone. Si el
    campo está vacío, solo queda la fila en handoff_requests (legacy)."""
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
        # Cargar datos del tenant para el envío WA humano.
        tenant_row = await conn.fetchrow(
            """
            SELECT t.name AS tenant_name,
                   ac.handoff_whatsapp_phone,
                   pc.provider, pc.credentials_encrypted
            FROM tenants t
            LEFT JOIN agent_configs ac ON ac.tenant_id = t.id
            LEFT JOIN provider_credentials pc ON pc.tenant_id = t.id
            WHERE t.id = $1
            """,
            tenant_id,
        )

    handoff_id = str(row["id"])
    # Notificación WA al humano (best-effort; no rompe si falla).
    target_phone = (tenant_row["handoff_whatsapp_phone"] or "").strip() if tenant_row else ""
    if target_phone and tenant_row:
        try:
            import json
            from app.crypto import descifrar
            from app.providers import obtener_proveedor

            creds: dict[str, Any] = {}
            if tenant_row["credentials_encrypted"]:
                try:
                    creds = json.loads(descifrar(tenant_row["credentials_encrypted"]))
                except Exception:
                    creds = {}
            adapter = obtener_proveedor(tenant_row["provider"] or "whapi", creds, "")
            prio_label = {"low": "🟢", "normal": "🟡", "urgent": "🔴"}.get(priority, "🟡")
            customer_label = customer_name or customer_phone or "cliente"
            body = (
                f"{prio_label} *Solicitud de atención* — {tenant_row['tenant_name']}\n\n"
                f"Cliente: {customer_label}\n"
                f"Motivo: {reason.strip()}\n"
                f"Prioridad: {priority}\n"
                f"Handoff id: {handoff_id[:8]}"
            )
            await adapter.enviar_mensaje(target_phone, body)
            logger.info(
                "handoff WA enviado",
                extra={
                    "event": "handoff_wa_notified",
                    "tenant_id": str(tenant_id),
                    "target_phone_tail": target_phone[-4:],
                    "handoff_id": handoff_id,
                },
            )
        except Exception:
            logger.exception(
                "handoff WA falló",
                extra={"event": "handoff_wa_error", "tenant_id": str(tenant_id)},
            )

    return {
        "ok": True,
        "handoff_id": handoff_id,
        "priority": priority,
        "reason": reason.strip(),
        "notified_human_phone": bool(target_phone),
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
