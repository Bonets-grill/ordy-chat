"""Tools del modo admin WhatsApp.

Las 12 tools que el dueño/staff puede pedir desde WhatsApp. Cada handler
recibe `conn` (asyncpg.Connection) + `tenant_id` + args del tool y devuelve
un dict plain que el LLM parsea y reformula al admin.

Las tools destructivas (deshabilitar_item, cancelar_reserva, cerrar_dia,
cambiar_horario, pausar_bot) NO ejecutan a ciegas — el ADMIN_SYSTEM_PROMPT
obliga al LLM a pedir confirmación ("¿Confirmas X?") ANTES de invocar la
tool. Cuando el admin responde "sí", el LLM llama la tool.

Schema para Claude Tools API compat con brain.py (Anthropic SDK).
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import Any
from uuid import UUID

import asyncpg

logger = logging.getLogger("ordychat.tools_admin")


# ══════════════════════════════════════════════════════════════════════
# SCHEMA de tools — forma esperada por Anthropic Messages API.
# ══════════════════════════════════════════════════════════════════════

TOOLS_ADMIN: list[dict[str, Any]] = [
    # ── Cat 1 — Stock / menú ─────────────────────────────────────────
    {
        "name": "deshabilitar_item",
        "description": (
            "Marca un item del menú como SIN STOCK / no disponible para los clientes. "
            "El cliente dejará de poder pedirlo. Caduca mañana 00:00 salvo `permanente`. "
            "USO literal: 'sin pulpo', 'hoy no hay tortilla', 'quita la X del menú', "
            "'fuera la burger dakota', 'se acabó el X', 'ponme sin stock el X'. "
            "ESTO NO ES habilitar_item. Pide confirmación antes de llamar."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "item_name": {"type": "string", "description": "Nombre del item tal como aparece en el menú."},
                "permanente": {"type": "boolean", "description": "Si true, no caduca. Default false.", "default": False},
                "note": {"type": "string", "description": "Nota opcional del dueño (ej: 'hasta que llegue el pedido')."},
            },
            "required": ["item_name"],
        },
    },
    {
        "name": "habilitar_item",
        "description": (
            "VUELVE A PONER en el menú un item que estaba sin stock. Es lo "
            "CONTRARIO de deshabilitar_item. USO literal: 'ya hay X otra vez', "
            "'vuelve a haber X', 'reactiva la X', 'ya tenemos X'. "
            "NO usar cuando el dueño quiera QUITAR un item — eso es deshabilitar_item."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "item_name": {"type": "string"},
            },
            "required": ["item_name"],
        },
    },
    {
        "name": "listar_items_deshabilitados",
        "description": "Lista los items actualmente sin stock (overrides con available=false activos).",
        "input_schema": {"type": "object", "properties": {}},
    },

    # ── Cat 2 — Horarios / cierres ───────────────────────────────────
    {
        "name": "cambiar_horario",
        "description": (
            "Cambia el horario de atención del negocio. Texto libre en español "
            "(ej: 'Lun-Vie 13-16 y 20-23, Sab-Dom cerrado'). Pide confirmación."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "nuevo_horario": {"type": "string"},
            },
            "required": ["nuevo_horario"],
        },
    },
    {
        "name": "pausar_bot",
        "description": "Pausa el bot: dejará de responder a clientes hasta que se reanude. Pide confirmación.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "reanudar_bot",
        "description": "Reanuda el bot tras haberlo pausado.",
        "input_schema": {"type": "object", "properties": {}},
    },

    # ── Cat 3 — Reservas ─────────────────────────────────────────────
    {
        "name": "listar_reservas_hoy",
        "description": "Lista las reservas (appointments) del día de hoy en TZ del tenant, ordenadas por hora.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "cancelar_reserva",
        "description": (
            "Cancela una reserva identificándola por hora y nombre del cliente. "
            "Ejemplo: 'cancela la de las 21:00 de Pérez'. Pide confirmación."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "hora": {"type": "string", "description": "HH:MM (24h)."},
                "nombre_hint": {"type": "string", "description": "Fragmento del nombre del cliente."},
            },
            "required": ["hora", "nombre_hint"],
        },
    },
    {
        "name": "cerrar_reservas_dia",
        "description": (
            "Añade un día a la lista de días cerrados (no se aceptarán reservas nuevas ese día). "
            "Formato YYYY-MM-DD. Pide confirmación."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "fecha": {"type": "string"},
            },
            "required": ["fecha"],
        },
    },

    # ── Cat 4 — Pedidos ──────────────────────────────────────────────
    {
        "name": "listar_pedidos_activos",
        "description": "Lista los pedidos activos de hoy (status distinto de completado/cancelado).",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "resumen_operativo_hoy",
        "description": (
            "Devuelve un resumen del día: nº de pedidos, facturación (€), "
            "nº de reservas confirmadas."
        ),
        "input_schema": {"type": "object", "properties": {}},
    },

    # ── Cat Handoff (C4 tanda 3c) ────────────────────────────────────
    {
        "name": "pausar_conversacion",
        "description": (
            "Pausa el bot SOLO en la conversación con un cliente específico. "
            "El bot deja de responder a ESE cliente hasta que lo reactives. "
            "Usa cuando el admin quiera atender personalmente a un cliente. "
            "Acepta el teléfono en cualquier formato (+34..., 34..., etc). "
            "Pide confirmación antes de llamar."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "customer_phone": {"type": "string", "description": "Teléfono del cliente a pausar."},
                "motivo": {"type": "string", "description": "Opcional: por qué se pausa (ej: 'queja compleja')."},
            },
            "required": ["customer_phone"],
        },
    },
    {
        "name": "reanudar_conversacion",
        "description": (
            "Reactiva el bot para una conversación que estaba pausada. "
            "El admin lo usa cuando termina de atender personalmente."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "customer_phone": {"type": "string"},
            },
            "required": ["customer_phone"],
        },
    },
    {
        "name": "listar_conversaciones_pausadas",
        "description": "Lista las conversaciones actualmente en handoff manual (bot silenciado por admin).",
        "input_schema": {"type": "object", "properties": {}},
    },

    # ── Cat FAQ ──────────────────────────────────────────────────────
    {
        "name": "agregar_faq",
        "description": (
            "Añade una entrada de FAQ al tenant. Uso típico: 'si preguntan por "
            "parking, diles que junto al Mercadona'. Pide confirmación."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "pregunta": {"type": "string"},
                "respuesta": {"type": "string"},
            },
            "required": ["pregunta", "respuesta"],
        },
    },

    # ── Cat REGLAS DURAS (persistentes, no time-bounded) ─────────────
    {
        "name": "agregar_regla",
        "description": (
            "Añade una REGLA DURA operativa del negocio — no negociable, "
            "persistente. El agente cliente la respetará siempre. Uso: "
            "'15 minutos antes del cierre de cocina solo aceptamos pedidos "
            "para llevar', 'nunca aceptamos reservas de más de 8 personas', "
            "'siempre ofrece postre tras el plato fuerte'. Distinto de "
            "deshabilitar_item (item-level) y de cambiar_horario (horario "
            "general). Pide confirmación antes de llamar."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "rule_text": {
                    "type": "string",
                    "description": "Texto claro en imperativo, <=500 chars.",
                },
                "priority": {
                    "type": "integer",
                    "description": "Prioridad 0-100 (higher first). Default 0.",
                },
            },
            "required": ["rule_text"],
        },
    },
    {
        "name": "listar_reglas",
        "description": (
            "Lista las reglas duras activas del negocio. READ — no pide "
            "confirmación. Útil antes de añadir o eliminar para no duplicar."
        ),
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "eliminar_regla",
        "description": (
            "Desactiva una regla dura por substring del texto. Ej. 'quita la "
            "regla de takeaway' → busca 'takeaway' en las reglas activas. Si "
            "coincide con >1, pide aclaración. Pide confirmación antes."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "pattern": {
                    "type": "string",
                    "description": "Substring a buscar en rule_text (case-insensitive).",
                },
            },
            "required": ["pattern"],
        },
    },
]


# ══════════════════════════════════════════════════════════════════════
# Helpers
# ══════════════════════════════════════════════════════════════════════


def _fin_del_dia_utc() -> datetime:
    """Mañana a las 00:00 UTC. Suficiente para el MVP (pierde ~1h por TZ Canarias
    pero no rompe nada — el override caduca un poco antes, no después)."""
    today = datetime.now(timezone.utc).date()
    from datetime import timedelta
    return datetime.combine(today + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)


def _err(mensaje: str) -> dict[str, Any]:
    return {"ok": False, "error": mensaje}


def _ok(**kwargs: Any) -> dict[str, Any]:
    return {"ok": True, **kwargs}


# ══════════════════════════════════════════════════════════════════════
# Handlers — uno por tool. Cada uno es async y recibe (conn, tenant_id, args).
# ══════════════════════════════════════════════════════════════════════


async def _h_deshabilitar_item(
    conn: asyncpg.Connection,
    tenant_id: UUID,
    args: dict[str, Any],
    admin_id: UUID | None = None,
) -> dict[str, Any]:
    item = (args.get("item_name") or "").strip()
    if not item:
        return _err("item_name vacío")
    permanente = bool(args.get("permanente", False))
    note = (args.get("note") or "").strip() or None
    active_until = None if permanente else _fin_del_dia_utc()
    await conn.execute(
        """
        INSERT INTO menu_overrides
            (tenant_id, item_name, available, note, active_until, created_by_admin_id)
        VALUES ($1, $2, false, $3, $4, $5)
        ON CONFLICT (tenant_id, item_name) DO UPDATE SET
            available = EXCLUDED.available,
            note = EXCLUDED.note,
            active_until = EXCLUDED.active_until,
            created_by_admin_id = EXCLUDED.created_by_admin_id,
            created_at = NOW()
        """,
        tenant_id, item, note, active_until, admin_id,
    )
    hasta = "indefinido" if permanente else active_until.isoformat()  # type: ignore[union-attr]
    logger.info(
        "item deshabilitado",
        extra={"event": "admin_disable_item", "tenant_id": str(tenant_id), "item": item},
    )
    return _ok(item=item, available=False, active_until=hasta)


async def _h_habilitar_item(
    conn: asyncpg.Connection,
    tenant_id: UUID,
    args: dict[str, Any],
    admin_id: UUID | None = None,
) -> dict[str, Any]:
    """Habilita un item (DELETE del override). Matching:
      1. Exact LOWER = LOWER (el usuario dijo el nombre canónico).
      2. Si 0 matches exactos → fuzzy ILIKE '%item%' substring.
         Si fuzzy devuelve 1 match → lo borra.
         Si fuzzy devuelve >1 matches → ok=false + lista candidates para
         que el LLM pida aclaración al admin.
      3. Si 0 matches en ambas → ok=false con mensaje explícito.
    Antes había solo match exacto LOWER: admin decía "habilita Dakota"
    pero DB tenía "Dakota burger" → 0 matches → tool ok=false, y el LLM
    ignoraba el error y decía "✓ habilitada" inventando.
    """
    item = (args.get("item_name") or "").strip()
    if not item:
        return _err("item_name vacío")
    # 1) match exacto case-insensitive
    exact = await conn.fetchrow(
        "SELECT item_name FROM menu_overrides "
        "WHERE tenant_id = $1 AND LOWER(item_name) = LOWER($2) LIMIT 1",
        tenant_id, item,
    )
    if exact:
        await conn.execute(
            "DELETE FROM menu_overrides WHERE tenant_id = $1 AND LOWER(item_name) = LOWER($2)",
            tenant_id, item,
        )
        return _ok(item=exact["item_name"], available=True, match="exact")
    # 2) fuzzy substring
    fuzzy = await conn.fetch(
        "SELECT item_name FROM menu_overrides "
        "WHERE tenant_id = $1 AND item_name ILIKE '%' || $2 || '%' "
        "ORDER BY length(item_name) ASC LIMIT 5",
        tenant_id, item,
    )
    if len(fuzzy) == 1:
        canon = fuzzy[0]["item_name"]
        await conn.execute(
            "DELETE FROM menu_overrides WHERE tenant_id = $1 AND item_name = $2",
            tenant_id, canon,
        )
        return _ok(item=canon, available=True, match="fuzzy", query=item)
    if len(fuzzy) > 1:
        return _err(
            f"'{item}' coincide con varios items: {', '.join(r['item_name'] for r in fuzzy)}. "
            f"Pídele al admin el nombre exacto."
        )
    return _err(f"'{item}' no estaba deshabilitado (no hay override con ese nombre)")


async def _h_listar_items_deshabilitados(
    conn: asyncpg.Connection,
    tenant_id: UUID,
    args: dict[str, Any],
    admin_id: UUID | None = None,
) -> dict[str, Any]:
    rows = await conn.fetch(
        """
        SELECT item_name, note, active_until
        FROM menu_overrides
        WHERE tenant_id = $1
          AND available = false
          AND (active_until IS NULL OR active_until > NOW())
        ORDER BY item_name
        """,
        tenant_id,
    )
    items = [
        {
            "item_name": r["item_name"],
            "note": r["note"],
            "active_until": r["active_until"].isoformat() if r["active_until"] else None,
        }
        for r in rows
    ]
    return _ok(count=len(items), items=items)


async def _h_cambiar_horario(
    conn: asyncpg.Connection,
    tenant_id: UUID,
    args: dict[str, Any],
    admin_id: UUID | None = None,
) -> dict[str, Any]:
    nuevo = (args.get("nuevo_horario") or "").strip()
    if len(nuevo) < 3:
        return _err("nuevo_horario muy corto")
    await conn.execute(
        "UPDATE agent_configs SET schedule = $2, updated_at = NOW() WHERE tenant_id = $1",
        tenant_id, nuevo,
    )
    return _ok(schedule=nuevo)


async def _h_pausar_bot(
    conn: asyncpg.Connection,
    tenant_id: UUID,
    args: dict[str, Any],
    admin_id: UUID | None = None,
) -> dict[str, Any]:
    await conn.execute(
        "UPDATE agent_configs SET paused = true, updated_at = NOW() WHERE tenant_id = $1",
        tenant_id,
    )
    return _ok(paused=True)


async def _h_reanudar_bot(
    conn: asyncpg.Connection,
    tenant_id: UUID,
    args: dict[str, Any],
    admin_id: UUID | None = None,
) -> dict[str, Any]:
    await conn.execute(
        "UPDATE agent_configs SET paused = false, updated_at = NOW() WHERE tenant_id = $1",
        tenant_id,
    )
    return _ok(paused=False)


async def _h_listar_reservas_hoy(
    conn: asyncpg.Connection,
    tenant_id: UUID,
    args: dict[str, Any],
    admin_id: UUID | None = None,
) -> dict[str, Any]:
    hoy = date.today()
    rows = await conn.fetch(
        """
        SELECT id, customer_name, customer_phone, starts_at, duration_min, status
        FROM appointments
        WHERE tenant_id = $1 AND starts_at::date = $2 AND status != 'cancelada'
        ORDER BY starts_at
        """,
        tenant_id, hoy,
    )
    reservas = [
        {
            "id": str(r["id"]),
            "hora": r["starts_at"].strftime("%H:%M"),
            "nombre": r["customer_name"],
            "telefono": r["customer_phone"],
            "duracion_min": r["duration_min"],
            "status": r["status"],
        }
        for r in rows
    ]
    return _ok(fecha=hoy.isoformat(), count=len(reservas), reservas=reservas)


async def _h_cancelar_reserva(
    conn: asyncpg.Connection,
    tenant_id: UUID,
    args: dict[str, Any],
    admin_id: UUID | None = None,
) -> dict[str, Any]:
    hora = (args.get("hora") or "").strip()
    hint = (args.get("nombre_hint") or "").strip().lower()
    if not hora or not hint:
        return _err("hora y nombre_hint son obligatorios")
    # Match por hora (HH:MM de starts_at hoy) + fragmento de nombre.
    rows = await conn.fetch(
        """
        SELECT id, customer_name, starts_at, status
        FROM appointments
        WHERE tenant_id = $1
          AND starts_at::date = CURRENT_DATE
          AND to_char(starts_at, 'HH24:MI') = $2
          AND LOWER(customer_name) LIKE '%' || $3 || '%'
          AND status != 'cancelada'
        """,
        tenant_id, hora, hint,
    )
    if not rows:
        return _err(f"no encuentro reserva a las {hora} que contenga '{hint}'")
    if len(rows) > 1:
        return _err(
            f"hay {len(rows)} reservas que cumplen — sé más específico con el nombre"
        )
    rid = rows[0]["id"]
    await conn.execute(
        "UPDATE appointments SET status = 'cancelada', updated_at = NOW() WHERE id = $1",
        rid,
    )
    return _ok(id=str(rid), cliente=rows[0]["customer_name"], hora=hora)


async def _h_cerrar_reservas_dia(
    conn: asyncpg.Connection,
    tenant_id: UUID,
    args: dict[str, Any],
    admin_id: UUID | None = None,
) -> dict[str, Any]:
    fecha = (args.get("fecha") or "").strip()
    try:
        date.fromisoformat(fecha)
    except ValueError:
        return _err("fecha debe ser YYYY-MM-DD")
    await conn.execute(
        """
        UPDATE agent_configs
        SET reservations_closed_for =
            CASE
              WHEN $2 = ANY(reservations_closed_for) THEN reservations_closed_for
              ELSE reservations_closed_for || ARRAY[$2]::TEXT[]
            END,
            updated_at = NOW()
        WHERE tenant_id = $1
        """,
        tenant_id, fecha,
    )
    return _ok(fecha_cerrada=fecha)


async def _h_listar_pedidos_activos(
    conn: asyncpg.Connection,
    tenant_id: UUID,
    args: dict[str, Any],
    admin_id: UUID | None = None,
) -> dict[str, Any]:
    rows = await conn.fetch(
        """
        SELECT id, customer_name, table_number, status, total_cents, created_at
        FROM orders
        WHERE tenant_id = $1
          AND created_at::date = CURRENT_DATE
          AND status NOT IN ('completado', 'cancelado', 'pagado', 'entregado')
        ORDER BY created_at DESC
        LIMIT 20
        """,
        tenant_id,
    )
    pedidos = [
        {
            "id_corto": str(r["id"])[:8],
            "cliente": r["customer_name"],
            "mesa": r["table_number"],
            "status": r["status"],
            "total_eur": round(r["total_cents"] / 100, 2),
            "hora": r["created_at"].strftime("%H:%M"),
        }
        for r in rows
    ]
    return _ok(count=len(pedidos), pedidos=pedidos)


async def _h_resumen_operativo_hoy(
    conn: asyncpg.Connection,
    tenant_id: UUID,
    args: dict[str, Any],
    admin_id: UUID | None = None,
) -> dict[str, Any]:
    row = await conn.fetchrow(
        """
        SELECT
          (SELECT COUNT(*) FROM orders o WHERE o.tenant_id = $1 AND o.created_at::date = CURRENT_DATE) AS n_pedidos,
          (SELECT COALESCE(SUM(total_cents), 0) FROM orders o WHERE o.tenant_id = $1 AND o.created_at::date = CURRENT_DATE AND o.status NOT IN ('cancelado')) AS caja_cents,
          (SELECT COUNT(*) FROM appointments a WHERE a.tenant_id = $1 AND a.starts_at::date = CURRENT_DATE AND a.status != 'cancelada') AS n_reservas
        """,
        tenant_id,
    )
    return _ok(
        fecha=date.today().isoformat(),
        n_pedidos=int(row["n_pedidos"]),
        caja_eur=round(int(row["caja_cents"]) / 100, 2),
        n_reservas=int(row["n_reservas"]),
    )


async def _h_pausar_conversacion(
    conn: asyncpg.Connection,
    tenant_id: UUID,
    args: dict[str, Any],
    admin_id: UUID | None = None,
) -> dict[str, Any]:
    from app.admin_resolver import normalizar_phone
    phone = normalizar_phone(args.get("customer_phone") or "")
    if not phone:
        return _err("customer_phone vacío")
    motivo = (args.get("motivo") or "").strip() or None
    await conn.execute(
        """
        INSERT INTO paused_conversations
            (tenant_id, customer_phone, paused_by_admin_id, reason)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (tenant_id, customer_phone) DO UPDATE SET
            paused_at = NOW(),
            paused_by_admin_id = EXCLUDED.paused_by_admin_id,
            reason = EXCLUDED.reason
        """,
        tenant_id, phone, admin_id, motivo,
    )
    logger.info(
        "conversación pausada por admin",
        extra={
            "event": "admin_conv_pause",
            "tenant_id": str(tenant_id),
            "customer_phone": phone,
        },
    )
    return _ok(customer_phone=phone, paused=True, motivo=motivo)


async def _h_reanudar_conversacion(
    conn: asyncpg.Connection,
    tenant_id: UUID,
    args: dict[str, Any],
    admin_id: UUID | None = None,
) -> dict[str, Any]:
    from app.admin_resolver import normalizar_phone
    phone = normalizar_phone(args.get("customer_phone") or "")
    if not phone:
        return _err("customer_phone vacío")
    result = await conn.execute(
        "DELETE FROM paused_conversations WHERE tenant_id = $1 AND customer_phone = $2",
        tenant_id, phone,
    )
    borrados = int(result.split()[-1]) if result.startswith("DELETE") else 0
    if borrados == 0:
        return _err(f"la conversación con {phone} no estaba pausada")
    logger.info(
        "conversación reactivada por admin",
        extra={
            "event": "admin_conv_resume",
            "tenant_id": str(tenant_id),
            "customer_phone": phone,
        },
    )
    return _ok(customer_phone=phone, paused=False)


async def _h_listar_conversaciones_pausadas(
    conn: asyncpg.Connection,
    tenant_id: UUID,
    args: dict[str, Any],
    admin_id: UUID | None = None,
) -> dict[str, Any]:
    rows = await conn.fetch(
        """
        SELECT customer_phone, paused_at, reason
        FROM paused_conversations
        WHERE tenant_id = $1
        ORDER BY paused_at DESC
        """,
        tenant_id,
    )
    pausadas = [
        {
            "customer_phone": r["customer_phone"],
            "paused_at": r["paused_at"].isoformat(),
            "reason": r["reason"],
        }
        for r in rows
    ]
    return _ok(count=len(pausadas), conversaciones=pausadas)


async def _h_agregar_faq(
    conn: asyncpg.Connection,
    tenant_id: UUID,
    args: dict[str, Any],
    admin_id: UUID | None = None,
) -> dict[str, Any]:
    pregunta = (args.get("pregunta") or "").strip()
    respuesta = (args.get("respuesta") or "").strip()
    if len(pregunta) < 3 or len(respuesta) < 3:
        return _err("pregunta y respuesta muy cortas")
    row = await conn.fetchrow(
        """
        INSERT INTO faqs (tenant_id, question, answer, order_index)
        VALUES ($1, $2, $3, COALESCE((SELECT MAX(order_index)+1 FROM faqs WHERE tenant_id=$1), 0))
        RETURNING id
        """,
        tenant_id, pregunta, respuesta,
    )
    return _ok(id=str(row["id"]), pregunta=pregunta)


async def _h_agregar_regla(
    conn: asyncpg.Connection,
    tenant_id: UUID,
    args: dict[str, Any],
    admin_id: UUID | None = None,
) -> dict[str, Any]:
    rule = (args.get("rule_text") or "").strip()
    if len(rule) < 3:
        return _err("rule_text muy corto (<3 chars)")
    if len(rule) > 500:
        return _err("rule_text muy largo (>500 chars)")
    priority = int(args.get("priority") or 0)
    if priority < 0 or priority > 100:
        priority = max(0, min(100, priority))
    row = await conn.fetchrow(
        """
        INSERT INTO agent_rules (tenant_id, rule_text, priority, created_by_admin_id)
        VALUES ($1, $2, $3, $4)
        RETURNING id
        """,
        tenant_id, rule, priority, admin_id,
    )
    logger.info(
        "regla añadida por admin",
        extra={
            "event": "admin_add_rule",
            "tenant_id": str(tenant_id),
            "rule_preview": rule[:60],
        },
    )
    return _ok(id=str(row["id"]), rule_text=rule, priority=priority)


async def _h_listar_reglas(
    conn: asyncpg.Connection,
    tenant_id: UUID,
    args: dict[str, Any],
    admin_id: UUID | None = None,
) -> dict[str, Any]:
    rows = await conn.fetch(
        """
        SELECT id, rule_text, priority, created_at
        FROM agent_rules
        WHERE tenant_id = $1 AND active = true
        ORDER BY priority DESC, created_at
        """,
        tenant_id,
    )
    reglas = [
        {
            "id": str(r["id"]),
            "rule_text": r["rule_text"],
            "priority": r["priority"],
            "created_at": r["created_at"].isoformat(),
        }
        for r in rows
    ]
    return _ok(count=len(reglas), reglas=reglas)


async def _h_eliminar_regla(
    conn: asyncpg.Connection,
    tenant_id: UUID,
    args: dict[str, Any],
    admin_id: UUID | None = None,
) -> dict[str, Any]:
    pattern = (args.get("pattern") or "").strip()
    if len(pattern) < 3:
        return _err("pattern muy corto (<3 chars)")
    # Buscar candidatos activos que contengan el substring.
    candidatos = await conn.fetch(
        """
        SELECT id, rule_text FROM agent_rules
        WHERE tenant_id = $1 AND active = true
          AND rule_text ILIKE '%' || $2 || '%'
        ORDER BY priority DESC, created_at
        LIMIT 5
        """,
        tenant_id, pattern,
    )
    if len(candidatos) == 0:
        return _err(f"ninguna regla activa coincide con '{pattern}'")
    if len(candidatos) > 1:
        return _err(
            f"'{pattern}' coincide con varias reglas: "
            + "; ".join(f'"{r["rule_text"]}"' for r in candidatos)
            + ". Pide al admin el texto más específico."
        )
    target = candidatos[0]
    # Soft delete: active=false conserva historial y permite rollback.
    await conn.execute(
        "UPDATE agent_rules SET active = false, updated_at = NOW() WHERE id = $1",
        target["id"],
    )
    logger.info(
        "regla desactivada por admin",
        extra={
            "event": "admin_remove_rule",
            "tenant_id": str(tenant_id),
            "rule_id": str(target["id"]),
        },
    )
    return _ok(id=str(target["id"]), rule_text=target["rule_text"], active=False)


# ══════════════════════════════════════════════════════════════════════
# Dispatch — el LLM envía tool_use.name + tool_use.input; el router
# localiza el handler y lo ejecuta dentro de la conexión del pool.
# ══════════════════════════════════════════════════════════════════════

_HANDLERS = {
    "deshabilitar_item": _h_deshabilitar_item,
    "habilitar_item": _h_habilitar_item,
    "listar_items_deshabilitados": _h_listar_items_deshabilitados,
    "cambiar_horario": _h_cambiar_horario,
    "pausar_bot": _h_pausar_bot,
    "reanudar_bot": _h_reanudar_bot,
    "listar_reservas_hoy": _h_listar_reservas_hoy,
    "cancelar_reserva": _h_cancelar_reserva,
    "cerrar_reservas_dia": _h_cerrar_reservas_dia,
    "listar_pedidos_activos": _h_listar_pedidos_activos,
    "resumen_operativo_hoy": _h_resumen_operativo_hoy,
    "pausar_conversacion": _h_pausar_conversacion,
    "reanudar_conversacion": _h_reanudar_conversacion,
    "listar_conversaciones_pausadas": _h_listar_conversaciones_pausadas,
    "agregar_faq": _h_agregar_faq,
    "agregar_regla": _h_agregar_regla,
    "listar_reglas": _h_listar_reglas,
    "eliminar_regla": _h_eliminar_regla,
}

# Tools que mutan estado — cada ejecución deja rastro en audit_log.
# Read-only tools (listar_*, resumen_*) se omiten para evitar inflar la tabla.
_MUTATIVE_TOOLS = frozenset({
    "deshabilitar_item",
    "habilitar_item",
    "cambiar_horario",
    "pausar_bot",
    "reanudar_bot",
    "cancelar_reserva",
    "cerrar_reservas_dia",
    "pausar_conversacion",
    "reanudar_conversacion",
    "agregar_faq",
    "agregar_regla",
    "eliminar_regla",
})


async def _log_audit(
    conn: asyncpg.Connection,
    tenant_id: UUID,
    tool_name: str,
    tool_input: dict[str, Any],
    admin_id: UUID | None,
    result: dict[str, Any],
) -> None:
    """Escribe una fila en audit_log por cada tool mutative. No tira — si
    esto falla no debe romper la respuesta al admin."""
    try:
        import json
        # admin_id es tenant_admins.id, no users.id → va en metadata, user_id NULL.
        metadata = {
            "admin_id": str(admin_id) if admin_id else None,
            "tool_input": tool_input,
            "tool_ok": bool(result.get("ok", False)),
            "tool_error": result.get("error"),
        }
        await conn.execute(
            """
            INSERT INTO audit_log (tenant_id, user_id, action, entity, entity_id, metadata)
            VALUES ($1, NULL, $2, 'tool_admin', NULL, $3::jsonb)
            """,
            tenant_id,
            f"admin_tool:{tool_name}",
            json.dumps(metadata, ensure_ascii=False, default=str),
        )
    except Exception:
        logger.exception(
            "audit_log write failed",
            extra={"event": "audit_log_error", "tool": tool_name, "tenant_id": str(tenant_id)},
        )


async def ejecutar_tool_admin(
    pool: asyncpg.Pool,
    tenant_id: UUID,
    tool_name: str,
    tool_input: dict[str, Any],
    admin_id: UUID | None = None,
) -> dict[str, Any]:
    """Despachador. Si el tool no existe o el handler lanza, captura y
    devuelve un dict error legible para el LLM. Cada tool mutative deja
    rastro en audit_log (P2 auditoría 2026-04-20)."""
    handler = _HANDLERS.get(tool_name)
    if handler is None:
        return _err(f"tool desconocida: {tool_name}")
    try:
        async with pool.acquire() as conn:
            result = await handler(conn, tenant_id, tool_input, admin_id)
            if tool_name in _MUTATIVE_TOOLS:
                await _log_audit(conn, tenant_id, tool_name, tool_input, admin_id, result)
            return result
    except Exception as e:
        logger.exception(
            "tool admin falló",
            extra={
                "event": "admin_tool_error",
                "tool": tool_name,
                "tenant_id": str(tenant_id),
            },
        )
        return _err(f"error interno: {type(e).__name__}")
