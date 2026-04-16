# runtime/app/tenants.py — Resolver tenant + cargar config + credenciales.

import json
import logging
from dataclasses import dataclass
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
                t.id, t.slug, t.name, t.subscription_status,
                ac.paused, ac.system_prompt, ac.fallback_message, ac.error_message,
                ac.max_messages_per_hour,
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
