# runtime/app/rate_limit.py — Rate limit por tenant (ventana deslizante de 1 hora).
#
# Estrategia: contar mensajes 'user' guardados en la última hora del tenant.
# Barato porque hay índice idx_msg_tenant (tenant_id, created_at DESC).

from uuid import UUID
from app.memory import inicializar_pool


async def mensajes_en_ultima_hora(tenant_id: UUID) -> int:
    pool = await inicializar_pool()
    async with pool.acquire() as conn:
        n = await conn.fetchval(
            """
            SELECT COUNT(*)
            FROM messages
            WHERE tenant_id = $1
              AND role = 'user'
              AND created_at > now() - interval '1 hour'
            """,
            tenant_id,
        )
    return int(n or 0)


async def limite_superado(tenant_id: UUID, limite: int) -> bool:
    if limite <= 0:
        return False
    return await mensajes_en_ultima_hora(tenant_id) >= limite
