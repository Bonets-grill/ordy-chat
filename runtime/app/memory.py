# runtime/app/memory.py — Pool Postgres + operaciones de memoria multi-tenant.

import os
import logging
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


async def guardar_intercambio(
    tenant_id: UUID,
    phone: str,
    mensaje_usuario: str,
    respuesta_agente: str,
    mensaje_id: str | None = None,
    tokens_in: int = 0,
    tokens_out: int = 0,
) -> None:
    """Upsert conversación + inserta user/assistant en una transacción."""
    pool = await inicializar_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            conv_id = await conn.fetchval(
                """
                INSERT INTO conversations (tenant_id, phone, last_message_at)
                VALUES ($1, $2, now())
                ON CONFLICT (tenant_id, phone)
                DO UPDATE SET last_message_at = now()
                RETURNING id
                """,
                tenant_id, phone,
            )
            await conn.execute(
                """
                INSERT INTO messages (conversation_id, tenant_id, role, content, mensaje_id, tokens_in)
                VALUES ($1, $2, 'user', $3, $4, $5)
                """,
                conv_id, tenant_id, mensaje_usuario, mensaje_id, tokens_in,
            )
            await conn.execute(
                """
                INSERT INTO messages (conversation_id, tenant_id, role, content, tokens_out)
                VALUES ($1, $2, 'assistant', $3, $4)
                """,
                conv_id, tenant_id, respuesta_agente, tokens_out,
            )
