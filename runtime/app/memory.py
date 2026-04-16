# runtime/app/memory.py — Pool Postgres + operaciones de memoria multi-tenant.
#
# Reemplaza el SQLite del AgentKit original. Todas las queries filtran por tenant_id.

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

    # asyncpg no entiende el sufijo channel_binding, se limpia
    dsn = dsn.replace("?channel_binding=require&sslmode=require", "?sslmode=require")
    dsn = dsn.replace("&channel_binding=require", "")

    _pool = await asyncpg.create_pool(
        dsn=dsn,
        min_size=1,
        max_size=10,
        command_timeout=30,
    )
    logger.info("Pool Postgres inicializado")
    return _pool


async def cerrar_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


async def obtener_historial(tenant_id: UUID, phone: str, limite: int = 20) -> list[dict]:
    """Recupera los últimos N mensajes de la conversación (orden cronológico)."""
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
            tenant_id, phone, limite,
        )
    return [{"role": r["role"], "content": r["content"]} for r in reversed(rows)]


async def guardar_intercambio(
    tenant_id: UUID,
    phone: str,
    mensaje_usuario: str,
    respuesta_agente: str,
    tokens_in: int = 0,
    tokens_out: int = 0,
) -> None:
    """Upsert de la conversación + inserta ambos mensajes en una transacción."""
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
                INSERT INTO messages (conversation_id, tenant_id, role, content, tokens_in)
                VALUES ($1, $2, 'user', $3, $4)
                """,
                conv_id, tenant_id, mensaje_usuario, tokens_in,
            )
            await conn.execute(
                """
                INSERT INTO messages (conversation_id, tenant_id, role, content, tokens_out)
                VALUES ($1, $2, 'assistant', $3, $4)
                """,
                conv_id, tenant_id, respuesta_agente, tokens_out,
            )
