# runtime/app/memory.py — Pool Postgres + operaciones de memoria multi-tenant.

import os
import logging
from typing import Any
from uuid import UUID
import asyncpg

logger = logging.getLogger("ordychat.memory")

_pool: asyncpg.Pool | None = None


async def inicializar_pool() -> asyncpg.Pool:
    """Crea el pool de conexiones al arrancar. Idempotente."""
    global _pool
    if _pool is not None:
        return _pool

    dsn = os.getenv("DATABASE_URL")
    if not dsn:
        raise RuntimeError("DATABASE_URL no configurada")

    dsn = dsn.replace("?channel_binding=require&sslmode=require", "?sslmode=require")
    dsn = dsn.replace("&channel_binding=require", "")

    _pool = await asyncpg.create_pool(
        dsn=dsn,
        min_size=1,
        max_size=10,
        command_timeout=30,
    )
    logger.info("pool postgres inicializado", extra={"event": "pool_init"})
    return _pool


async def cerrar_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


async def obtener_historial(
    tenant_id: UUID,
    phone: str,
    limite_mensajes: int = 20,
    max_chars: int = 20000,
) -> list[dict]:
    """Recupera los últimos N mensajes, truncando si superan max_chars totales."""
    pool = await inicializar_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT m.role, m.content
            FROM messages m
            JOIN conversations c ON c.id = m.conversation_id
            WHERE c.tenant_id = $1 AND c.phone = $2
            ORDER BY m.created_at DESC
            LIMIT $3
            """,
            tenant_id, phone, limite_mensajes,
        )

    # Invertir a orden cronológico y truncar por presupuesto de chars.
    ordenados = [{"role": r["role"], "content": r["content"]} for r in reversed(rows)]

    total = 0
    recortados: list[dict] = []
    # Recorremos de más reciente a más antiguo descartando los más viejos si no caben.
    for m in reversed(ordenados):
        cost = len(m["content"])
        if total + cost > max_chars:
            break
        recortados.append(m)
        total += cost
    return list(reversed(recortados))


async def ya_procesado(tenant_id: UUID, mensaje_id: str) -> bool:
    """
    Marca el mensaje_id como procesado de forma atómica.
    Retorna True si YA estaba procesado (debemos saltar), False si es nuevo.
    """
    if not mensaje_id:
        return False
    pool = await inicializar_pool()
    async with pool.acquire() as conn:
        inserted = await conn.fetchval(
            """
            INSERT INTO processed_messages (tenant_id, mensaje_id)
            VALUES ($1, $2)
            ON CONFLICT (tenant_id, mensaje_id) DO NOTHING
            RETURNING 1
            """,
            tenant_id, mensaje_id,
        )
    return inserted is None


async def actualizar_nombre_cliente(
    tenant_id: UUID,
    phone: str,
    customer_name: str | None,
    is_test: bool = False,
) -> None:
    """
    Persiste el nombre del cliente en conversations.customer_name.
    COALESCE: si ya había un nombre guardado y llega NULL/vacío, NO sobreescribe.
    Crea la fila si no existe.

    is_test=True se usa desde el playground para marcar la conversación como
    de prueba. Solo se aplica al INSERT inicial (no cambia una fila ya
    existente de prueba a real o viceversa).
    """
    if customer_name is not None:
        customer_name = customer_name.strip()
        if not customer_name or len(customer_name) > 120:
            return
    if not customer_name:
        return
    pool = await inicializar_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO conversations (tenant_id, phone, customer_name, last_message_at, is_test)
            VALUES ($1, $2, $3, now(), $4)
            ON CONFLICT (tenant_id, phone)
            DO UPDATE SET customer_name = COALESCE(EXCLUDED.customer_name, conversations.customer_name)
            """,
            tenant_id, phone, customer_name, is_test,
        )


async def obtener_contexto_cliente(
    tenant_id: UUID,
    phone: str,
) -> dict[str, Any]:
    """
    Devuelve contexto persistente que se inyecta al system prompt:
      - customer_name: str | None
      - ultimo_pedido: {fecha, items:[{name,qty}], total_eur} | None (orders pagados últimos 60 días)
      - proxima_cita: {fecha_iso, title} | None (appointments futuras)
    Vacío si no hay datos. Barato: 3 queries indexadas.
    """
    pool = await inicializar_pool()
    async with pool.acquire() as conn:
        nombre_row = await conn.fetchrow(
            "SELECT customer_name FROM conversations WHERE tenant_id=$1 AND phone=$2",
            tenant_id, phone,
        )
        pedido_row = await conn.fetchrow(
            """
            SELECT id, paid_at, total_cents, currency
            FROM orders
            WHERE tenant_id=$1 AND customer_phone=$2 AND status='paid'
              AND paid_at > now() - interval '60 days'
            ORDER BY paid_at DESC
            LIMIT 1
            """,
            tenant_id, phone,
        )
        items: list[dict[str, Any]] = []
        if pedido_row is not None:
            item_rows = await conn.fetch(
                "SELECT name, quantity FROM order_items WHERE order_id=$1 ORDER BY id",
                pedido_row["id"],
            )
            items = [{"name": r["name"], "qty": r["quantity"]} for r in item_rows]
        cita_row = await conn.fetchrow(
            """
            SELECT starts_at, title
            FROM appointments
            WHERE tenant_id=$1 AND customer_phone=$2
              AND status IN ('pending', 'confirmed') AND starts_at > now()
            ORDER BY starts_at ASC
            LIMIT 1
            """,
            tenant_id, phone,
        )

    ctx: dict[str, Any] = {}
    if nombre_row and nombre_row["customer_name"]:
        ctx["customer_name"] = nombre_row["customer_name"]
    if pedido_row is not None and items:
        ctx["ultimo_pedido"] = {
            "fecha": pedido_row["paid_at"].date().isoformat(),
            "items": items,
            "total_eur": round(pedido_row["total_cents"] / 100, 2),
            "currency": pedido_row["currency"],
        }
    if cita_row is not None:
        ctx["proxima_cita"] = {
            "fecha_iso": cita_row["starts_at"].isoformat(),
            "title": cita_row["title"],
        }
    return ctx


async def guardar_intercambio(
    tenant_id: UUID,
    phone: str,
    mensaje_usuario: str,
    respuesta_agente: str,
    mensaje_id: str | None = None,
    tokens_in: int = 0,
    tokens_out: int = 0,
    is_test: bool = False,
) -> None:
    """Upsert conversación + inserta user/assistant en una transacción.

    is_test=True se propaga a conversations (en el INSERT inicial; si la
    conversación ya existe, se respeta su flag anterior — no permitimos que
    un mensaje de test "ensucie" una conversación real preexistente) y a
    ambos messages. Dashboards filtran is_test=false por defecto.
    """
    pool = await inicializar_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            conv_id = await conn.fetchval(
                """
                INSERT INTO conversations (tenant_id, phone, last_message_at, is_test)
                VALUES ($1, $2, now(), $3)
                ON CONFLICT (tenant_id, phone)
                DO UPDATE SET last_message_at = now()
                RETURNING id
                """,
                tenant_id, phone, is_test,
            )
            await conn.execute(
                """
                INSERT INTO messages (conversation_id, tenant_id, role, content, mensaje_id, tokens_in, is_test)
                VALUES ($1, $2, 'user', $3, $4, $5, $6)
                """,
                conv_id, tenant_id, mensaje_usuario, mensaje_id, tokens_in, is_test,
            )
            await conn.execute(
                """
                INSERT INTO messages (conversation_id, tenant_id, role, content, tokens_out, is_test)
                VALUES ($1, $2, 'assistant', $3, $4, $5)
                """,
                conv_id, tenant_id, respuesta_agente, tokens_out, is_test,
            )
