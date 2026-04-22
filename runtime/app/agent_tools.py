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
    is_test: bool = False,
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
              (tenant_id, customer_phone, customer_name, starts_at, duration_min, title, notes, is_test)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            RETURNING id, starts_at
            """,
            tenant_id, customer_phone, customer_name, starts_at, duration_min, title.strip(), notes, is_test,
        )
    return {
        "ok": True,
        "appointment_id": str(row["id"]),
        "starts_at_iso": row["starts_at"].isoformat(),
        "duration_min": duration_min,
        "title": title.strip(),
        "is_test": is_test,
    }


async def crear_handoff(
    tenant_id: UUID,
    customer_phone: str,
    reason: str,
    priority: str = "normal",
    customer_name: str | None = None,
    conversation_id: UUID | None = None,
    sandbox: bool = False,
) -> dict[str, Any]:
    """Registra solicitud de humano + manda WhatsApp al teléfono humano que
    el tenant configuró en agent_configs.handoff_whatsapp_phone. Si el
    campo está vacío, solo queda la fila en handoff_requests (legacy).

    Con sandbox=True (invocación desde /dashboard/playground): el WA SÍ se
    envía al admin pero con prefijo "🧪 PRUEBA PLAYGROUND" + reason
    prefijado "[PLAYGROUND]" para que quede visible en dashboard y Mario
    pueda descartar de las métricas reales con un WHERE reason LIKE ... .
    """
    if priority not in ("low", "normal", "urgent"):
        priority = "normal"
    if not reason or len(reason.strip()) < 3:
        return {"ok": False, "error": "reason requerido (min 3 chars)"}

    reason_clean = reason.strip()
    reason_stored = f"[PLAYGROUND] {reason_clean}" if sandbox else reason_clean
    # Mig 029: sandbox=True implica is_test=True en DB. Mantenemos también el
    # prefijo [PLAYGROUND] en reason para retrocompat con filtros antiguos.
    is_test = bool(sandbox)

    pool = await inicializar_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO handoff_requests
              (tenant_id, conversation_id, customer_phone, customer_name, reason, priority, is_test)
            VALUES ($1,$2,$3,$4,$5,$6,$7)
            RETURNING id, created_at
            """,
            tenant_id, conversation_id, customer_phone, customer_name, reason_stored, priority, is_test,
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
            sandbox_header = "🧪 *PRUEBA PLAYGROUND* — ignora si no estabas testeando\n\n" if sandbox else ""
            body = (
                f"{sandbox_header}"
                f"{prio_label} *Solicitud de atención* — {tenant_row['tenant_name']}\n\n"
                f"Cliente: {customer_label}\n"
                f"Motivo: {reason_clean}\n"
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
        "is_test": is_test,
    }


async def obtener_pedido_pendiente_eta(
    tenant_id: UUID, customer_phone: str
) -> dict[str, Any] | None:
    """Devuelve el pedido más reciente del cliente que está esperando que él
    confirme el ETA propuesto por cocina. None si no hay ninguno.

    Estado esperado: status='pending_kitchen_review' AND
    kitchen_decision='accepted' AND customer_eta_decision IS NULL.
    """
    pool = await inicializar_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT id, pickup_eta_minutes, total_cents, currency, order_type
            FROM orders
            WHERE tenant_id = $1
              AND customer_phone = $2
              AND status = 'pending_kitchen_review'
              AND kitchen_decision = 'accepted'
              AND customer_eta_decision IS NULL
            ORDER BY created_at DESC
            LIMIT 1
            """,
            tenant_id, customer_phone,
        )
    if not row:
        return None
    return {
        "id": str(row["id"]),
        "eta_minutes": row["pickup_eta_minutes"],
        "total_eur": (row["total_cents"] or 0) / 100,
        "currency": row["currency"] or "EUR",
        "order_type": row["order_type"],
    }


async def responder_eta_pedido(
    tenant_id: UUID,
    customer_phone: str,
    accepted: bool,
) -> dict[str, Any]:
    """Procesa la respuesta del cliente al ETA propuesto por cocina.

    accepted=True → status='pending' (entra al flujo KDS normal,
                    cocina lo cocina y avanza a preparing/ready).
    accepted=False → status='canceled', cliente declinó el tiempo.

    Idempotente por orden: solo afecta orders del cliente en el estado
    correcto (pending_kitchen_review + accepted + decision NULL). Race-safe
    por la combinación tenant+customer_phone.
    """
    pool = await inicializar_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            UPDATE orders
            SET customer_eta_decision = $3,
                status = CASE WHEN $3 = 'accepted' THEN 'pending' ELSE 'canceled' END,
                updated_at = now()
            WHERE tenant_id = $1
              AND customer_phone = $2
              AND status = 'pending_kitchen_review'
              AND kitchen_decision = 'accepted'
              AND customer_eta_decision IS NULL
            RETURNING id, status
            """,
            tenant_id, customer_phone, "accepted" if accepted else "rejected",
        )
    if not row:
        return {"ok": False, "error": "no_pending_eta", "hint": "No hay pedido pendiente de confirmación de ETA para este cliente."}
    return {
        "ok": True,
        "order_id": str(row["id"]),
        "status": row["status"],
        "decision": "accepted" if accepted else "rejected",
    }


async def modificar_pedido(
    tenant_id: UUID,
    customer_phone: str,
    change_request: str,
    customer_name: str | None = None,
    is_test: bool = False,
) -> dict[str, Any]:
    """Añade una modificación al último pedido del cliente que todavía no
    ha sido decidido por cocina (status='pending_kitchen_review' AND
    kitchen_decision='pending'). Reemplaza el bug de duplicado del 22-abr:
    cuando el cliente pide un cambio post-pedido, el bot llamaba crear_pedido
    de nuevo creando 2 cards en el KDS.

    Efecto:
      - UPDATE orders.notes (prepended con timestamp + cliente label).
      - Enviar WA al admin del tenant (handoff_whatsapp_phone) con el cambio.

    Devuelve:
      - ok=True si el pedido existía y estaba modificable.
      - ok=False, error='pedido_ya_en_preparacion' si ya decidido → bot
        debe disculparse con el cliente.
      - ok=False, error='no_hay_pedido' si el cliente nunca pidió nada.

    En sandbox (is_test=True): la UPDATE va contra filas is_test=true
    (playground) y la notificación WA añade prefijo "🧪 PRUEBA PLAYGROUND".
    """
    if not change_request or len(change_request.strip()) < 3:
        return {"ok": False, "error": "request_vacia", "hint": "El cambio solicitado está vacío. Pregúntale al cliente qué quiere modificar."}

    change_clean = change_request.strip()[:500]

    pool = await inicializar_pool()
    async with pool.acquire() as conn:
        # Último pedido del cliente, filtrado por is_test para no cruzar
        # prod↔playground.
        row = await conn.fetchrow(
            """
            SELECT id, status, kitchen_decision, notes
            FROM orders
            WHERE tenant_id = $1
              AND customer_phone = $2
              AND is_test = $3
            ORDER BY created_at DESC
            LIMIT 1
            """,
            tenant_id, customer_phone, is_test,
        )
        if not row:
            return {
                "ok": False,
                "error": "no_hay_pedido",
                "hint": "El cliente no tiene ningún pedido previo. Si quiere hacer uno nuevo, usa crear_pedido.",
            }

        if row["status"] != "pending_kitchen_review" or row["kitchen_decision"] != "pending":
            return {
                "ok": False,
                "error": "pedido_ya_en_preparacion",
                "hint": (
                    "La cocina ya decidió sobre el pedido anterior, no puedes modificarlo. "
                    "Discúlpate con el cliente: 'Lo sentimos mucho, ese pedido ya está en "
                    "preparación y no podemos modificarlo.'"
                ),
            }

        now_hhmm = datetime.now(ZoneInfo("Europe/Madrid")).strftime("%H:%M")
        label = customer_name or customer_phone or "cliente"
        new_note = f"[MOD {now_hhmm} — {label}] {change_clean}"
        await conn.execute(
            """
            UPDATE orders
            SET notes = CASE
                  WHEN notes IS NULL OR notes = '' THEN $2
                  ELSE notes || E'\n' || $2
                END,
                updated_at = now()
            WHERE id = $1
            """,
            row["id"], new_note,
        )

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

    order_id = str(row["id"])
    notified = False
    target_phone = (tenant_row["handoff_whatsapp_phone"] or "").strip() if tenant_row else ""
    if target_phone and tenant_row:
        try:
            import json as _json
            from app.crypto import descifrar
            from app.providers import obtener_proveedor

            creds: dict[str, Any] = {}
            if tenant_row["credentials_encrypted"]:
                try:
                    creds = _json.loads(descifrar(tenant_row["credentials_encrypted"]))
                except Exception:
                    creds = {}
            adapter = obtener_proveedor(tenant_row["provider"] or "whapi", creds, "")
            test_header = "🧪 *PRUEBA PLAYGROUND*\n\n" if is_test else ""
            body = (
                f"{test_header}"
                f"🔔 *Modificación de pedido* — {tenant_row['tenant_name']}\n\n"
                f"Cliente: {label}\n"
                f"Pedido id: {order_id[:8]}\n"
                f"Cambio solicitado: {change_clean}\n\n"
                f"Revísalo en el KDS antes de aceptar el pedido."
            )
            await adapter.enviar_mensaje(target_phone, body)
            notified = True
            logger.info(
                "modificar_pedido WA enviado",
                extra={
                    "event": "mod_wa_notified",
                    "tenant_id": str(tenant_id),
                    "order_id": order_id,
                    "target_phone_tail": target_phone[-4:],
                },
            )
        except Exception:
            logger.exception(
                "modificar_pedido WA falló",
                extra={"event": "mod_wa_error", "tenant_id": str(tenant_id), "order_id": order_id},
            )

    return {
        "ok": True,
        "order_id": order_id,
        "notified_human_phone": notified,
        "is_test": is_test,
        "instruccion_al_cliente": (
            "Confirma al cliente en UNA frase corta que anotaste el cambio y se lo pasaste "
            "a cocina. Tono natural, NO digas 'modificación registrada'."
        ),
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
