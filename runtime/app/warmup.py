# runtime/app/warmup.py — Warm-up anti-ban para instancias Evolution nuevas.
#
# Evolution/Baileys banean cuentas que de golpe envían >30-100 mensajes/día
# recién conectadas. Protocolo de escalada basado en edad de la instancia
# (provider_credentials.instance_created_at):
#
#   Fase    Edad (días)   Cap mensajes/día
#   fresh      0–3              30
#   early      4–7             100
#   mid        8–14            300
#   mature    15+          sin cap (solo max_messages_per_hour)
#
# Aplica solo a provider='evolution'. Los otros proveedores (meta/whapi/twilio)
# tienen warm-up propio gestionado por ellos.

import logging
from uuid import UUID

from app.memory import inicializar_pool

logger = logging.getLogger("ordychat.warmup")

# (edad_max_dias_inclusive, cap_diario). None = sin cap.
_WARMUP_TIERS: tuple[tuple[int, int], ...] = (
    (3, 30),
    (7, 100),
    (14, 300),
)


def calcular_cap(dias_desde_creacion: int) -> int | None:
    """Devuelve el cap diario en mensajes según edad en días.
    None = ya maduró (15+ días), no aplica cap del warmup (rate-limit normal sí)."""
    if dias_desde_creacion < 0:
        return _WARMUP_TIERS[0][1]  # defensivo: created_at futuro → tratar como fresh
    for max_days, cap in _WARMUP_TIERS:
        if dias_desde_creacion <= max_days:
            return cap
    return None


async def limite_diario_warmup(tenant_id: UUID) -> int | None:
    """
    Lee provider_credentials.instance_created_at y devuelve el cap del día.
    - Si provider != 'evolution': sin warmup → None.
    - Si burned=true: sin warmup (la instancia no debería enviar; el caller
      debe haber cortado antes). Aquí devolvemos 0 como kill-switch.
    - Si matura: None.
    """
    pool = await inicializar_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT provider, instance_created_at, burned,
                   EXTRACT(DAY FROM (now() - instance_created_at))::int AS dias
            FROM provider_credentials
            WHERE tenant_id = $1
            """,
            tenant_id,
        )
    if row is None:
        return None
    if row["burned"]:
        return 0
    if row["provider"] != "evolution":
        return None
    return calcular_cap(int(row["dias"] or 0))


async def mensajes_assistant_hoy(tenant_id: UUID) -> int:
    """Cuenta mensajes role='assistant' enviados HOY (UTC).
    Usa el índice idx_msg_tenant existente."""
    pool = await inicializar_pool()
    async with pool.acquire() as conn:
        n = await conn.fetchval(
            """
            SELECT COUNT(*)
            FROM messages
            WHERE tenant_id = $1
              AND role = 'assistant'
              AND created_at::date = CURRENT_DATE
            """,
            tenant_id,
        )
    return int(n or 0)


async def chequear_warmup(tenant_id: UUID) -> dict:
    """Retorna estado de warmup para decidir si bloquear o pasar.

    Returns:
      {blocked: bool, reason: str|None, cap: int|None, sent_today: int|None,
       days: int|None, tier: 'fresh'|'early'|'mid'|'mature'|'burned'|None}
    """
    pool = await inicializar_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT provider, burned,
                   EXTRACT(DAY FROM (now() - instance_created_at))::int AS dias
            FROM provider_credentials
            WHERE tenant_id = $1
            """,
            tenant_id,
        )

    if row is None:
        return {"blocked": False, "reason": None, "cap": None, "sent_today": None,
                "days": None, "tier": None}

    if row["burned"]:
        return {"blocked": True, "reason": "burned", "cap": 0, "sent_today": None,
                "days": int(row["dias"] or 0), "tier": "burned"}

    if row["provider"] != "evolution":
        return {"blocked": False, "reason": None, "cap": None, "sent_today": None,
                "days": int(row["dias"] or 0), "tier": "mature"}

    days = int(row["dias"] or 0)
    cap = calcular_cap(days)
    tier = _tier_por_dias(days)
    if cap is None:
        return {"blocked": False, "reason": None, "cap": None, "sent_today": None,
                "days": days, "tier": tier}

    sent = await mensajes_assistant_hoy(tenant_id)
    if sent >= cap:
        return {"blocked": True, "reason": "warmup_cap", "cap": cap, "sent_today": sent,
                "days": days, "tier": tier}
    return {"blocked": False, "reason": None, "cap": cap, "sent_today": sent,
            "days": days, "tier": tier}


def _tier_por_dias(days: int) -> str:
    if days <= 3:
        return "fresh"
    if days <= 7:
        return "early"
    if days <= 14:
        return "mid"
    return "mature"
