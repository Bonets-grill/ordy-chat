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
    """Todo lo que el webhook necesita para procesar un mensaje de este tenant."""
    id: UUID
    slug: str
    name: str
    subscription_status: str
    paused: bool
    system_prompt: str
    fallback_message: str
    error_message: str
    provider: str
    credentials: dict


class TenantNotFound(Exception):
    pass


class TenantInactive(Exception):
    pass


async def cargar_tenant_por_slug(slug: str) -> TenantContext:
    """Lee tenant + agent_config + provider_credentials en una query."""
    pool = await inicializar_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT
                t.id, t.slug, t.name, t.subscription_status,
                ac.paused, ac.system_prompt, ac.fallback_message, ac.error_message,
                pc.provider, pc.credentials_encrypted
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
            logger.error("Error descifrando credentials de %s: %s", slug, e)

    return TenantContext(
        id=row["id"],
        slug=row["slug"],
        name=row["name"],
        subscription_status=row["subscription_status"],
        paused=row["paused"] or False,
        system_prompt=row["system_prompt"],
        fallback_message=row["fallback_message"],
        error_message=row["error_message"],
        provider=row["provider"] or "whapi",
        credentials=credentials,
    )


async def obtener_anthropic_api_key(tenant_credentials: dict) -> str:
    """
    Prioridad de keys:
    1. El tenant trae su propia key en provider_credentials.anthropic_api_key
    2. ENV ANTHROPIC_API_KEY
    3. platform_settings.anthropic_api_key (cifrada)
    """
    import os

    if tenant_credentials.get("anthropic_api_key"):
        return tenant_credentials["anthropic_api_key"]

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
            logger.error("Error descifrando anthropic_api_key global: %s", e)

    raise RuntimeError("No hay ANTHROPIC_API_KEY disponible (ni tenant, ni env, ni platform)")
