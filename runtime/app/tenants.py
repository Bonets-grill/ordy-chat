# runtime/app/tenants.py — Resolver tenant + cargar config + credenciales.

import json
import logging
from dataclasses import dataclass, field
from uuid import UUID

from app.crypto import descifrar
from app.memory import inicializar_pool

logger = logging.getLogger("ordychat.tenants")


@dataclass
class TenantContext:
    id: UUID
    slug: str
    name: str
    subscription_status: str
    paused: bool
    system_prompt: str
    fallback_message: str
    error_message: str
    max_messages_per_hour: int
    provider: str
    credentials: dict
    webhook_secret: str
    # Horario libre (texto). Se inyecta como <horario> en system prompt en cada
    # turno para que el bot nunca reserve fuera del rango o en día cerrado.
    schedule: str = ""
    # Zona horaria IANA (ej: Europe/Madrid, Atlantic/Canary). Default peninsular.
    # Derivada de billing_country si existe — por ahora hardcoded hasta migration 014.
    timezone: str = "Europe/Madrid"
    # Fechas YYYY-MM-DD en que el tenant NO acepta reservas (migración 015).
    # Se inyectan en <dias_cerrados> del system_prompt y crear_cita hace
    # double-guard contra este array.
    reservations_closed_for: list[str] = field(default_factory=list)
    # Campos expuestos para el validador (judge no_inventa ground truth) y
    # potencialmente para otros consumidores. Todos tienen default seguro.
    tone: str = "friendly"
    business_description: str = ""
    payment_methods: list[str] = field(default_factory=list)
    accept_online_payment: bool = False
    # Migración 031: texto que el tenant edita en /dashboard/carta para que el
    # bot ofrezca bebidas curadas en el primer turno del QR de mesa. Vacío →
    # el bot pregunta "¿qué os apetece?" de forma abierta.
    drinks_greeting_pitch: str = ""


class TenantNotFound(Exception):
    pass


class TenantInactive(Exception):
    pass


async def cargar_tenant_por_slug(slug: str) -> TenantContext:
    pool = await inicializar_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT
                t.id, t.slug, t.name, t.subscription_status, t.billing_country,
                t.timezone, t.billing_city,
                ac.paused, ac.system_prompt, ac.fallback_message, ac.error_message,
                ac.max_messages_per_hour, ac.schedule, ac.reservations_closed_for,
                ac.tone, ac.business_description,
                ac.payment_methods, ac.accept_online_payment,
                ac.drinks_greeting_pitch,
                pc.provider, pc.credentials_encrypted, pc.webhook_secret
            FROM tenants t
            LEFT JOIN agent_configs ac ON ac.tenant_id = t.id
            LEFT JOIN provider_credentials pc ON pc.tenant_id = t.id
            WHERE t.slug = $1
            """,
            slug,
        )

    if row is None:
        raise TenantNotFound(f"No existe tenant con slug={slug}")

    if row["subscription_status"] not in ("trialing", "active"):
        raise TenantInactive(
            f"Tenant {slug} tiene subscription_status={row['subscription_status']}"
        )

    if row["system_prompt"] is None:
        raise TenantInactive(f"Tenant {slug} no completó el onboarding")

    credentials: dict = {}
    if row["credentials_encrypted"]:
        try:
            credentials = json.loads(descifrar(row["credentials_encrypted"]))
        except Exception as e:
            logger.error(
                "error descifrando credentials",
                extra={"tenant_slug": slug, "event": "creds_decrypt_error"},
                exc_info=e,
            )
            raise TenantInactive(f"Credenciales de {slug} no legibles") from e

    # Timezone: columna explícita (migration 014). Default 'Europe/Madrid' a
    # nivel DB. Fallback defensivo a keyword de billing_city solo si la columna
    # apareciese vacía (no debería post-migration, pero no cuesta nada).
    tz = row["timezone"]
    if not tz:
        billing_city = (row["billing_city"] or "").lower()
        is_canarias = any(
            kw in billing_city
            for kw in ("tenerife", "palmas", "lanzarote", "fuerteventura", "gomera", "hierro")
        )
        tz = "Atlantic/Canary" if is_canarias else "Europe/Madrid"

    # asyncpg devuelve DATE[] como list[datetime.date]. Normalizamos a list[str]
    # YYYY-MM-DD para serializar fácil y comparar con today_iso.
    closed_raw = row["reservations_closed_for"] or []
    closed_for: list[str] = [d.isoformat() if hasattr(d, "isoformat") else str(d) for d in closed_raw]

    return TenantContext(
        id=row["id"],
        slug=row["slug"],
        name=row["name"],
        subscription_status=row["subscription_status"],
        paused=row["paused"] or False,
        system_prompt=row["system_prompt"],
        fallback_message=row["fallback_message"],
        error_message=row["error_message"],
        max_messages_per_hour=row["max_messages_per_hour"] or 200,
        provider=row["provider"] or "whapi",
        credentials=credentials,
        webhook_secret=row["webhook_secret"] or "",
        schedule=row["schedule"] or "",
        timezone=tz,
        reservations_closed_for=closed_for,
        tone=row["tone"] or "friendly",
        business_description=row["business_description"] or "",
        payment_methods=list(row["payment_methods"] or []),
        accept_online_payment=bool(row["accept_online_payment"]),
        drinks_greeting_pitch=(row["drinks_greeting_pitch"] or "").strip(),
    )


async def obtener_anthropic_api_key(tenant_credentials: dict) -> str:
    """
    Prioridad: env ANTHROPIC_API_KEY (master global) → platform_settings → tenant.
    Para Ordy Chat el modelo por defecto es master key global.
    """
    import os

    env_key = os.getenv("ANTHROPIC_API_KEY", "")
    if env_key:
        return env_key

    pool = await inicializar_pool()
    async with pool.acquire() as conn:
        encrypted = await conn.fetchval(
            "SELECT value_encrypted FROM platform_settings WHERE key = 'anthropic_api_key'"
        )
    if encrypted:
        try:
            return descifrar(encrypted)
        except Exception as e:
            logger.error(
                "error descifrando anthropic_api_key global",
                extra={"event": "platform_key_decrypt_error"},
                exc_info=e,
            )

    # Último recurso: key por tenant (solo si alguien lo configuró manualmente).
    per_tenant = tenant_credentials.get("anthropic_api_key")
    if per_tenant:
        return per_tenant

    raise RuntimeError("No hay ANTHROPIC_API_KEY disponible (ni env, ni platform, ni tenant)")
