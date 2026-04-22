"""runtime/app/messaging.py — Helper genérico para enviar mensajes WA proactivos.

Antes de este helper, solo `crear_handoff` enviaba mensajes proactivos al humano
del tenant (admin). Las notificaciones del workflow cocina ↔ cliente (mig 027)
necesitan enviar AL CLIENTE FINAL desde el backend, sin estar respondiendo a un
webhook entrante.

Reusa el patrón de `agent_tools.crear_handoff` (líneas ~143-184): carga creds
descifradas del tenant, instancia el adapter del proveedor, manda el mensaje.

Si el envío falla (sin creds, adapter crashea, número bloqueado), el helper NO
levanta excepción — devuelve False y loguea. El llamador decide si recuperar.
"""

from __future__ import annotations

import json
import logging
from typing import Any
from uuid import UUID

from app.crypto import descifrar
from app.memory import inicializar_pool
from app.providers import obtener_proveedor

logger = logging.getLogger("ordychat.messaging")


async def enviar_a_cliente(
    tenant_id: UUID,
    customer_phone: str,
    body: str,
) -> bool:
    """Envía un mensaje WA proactivo a `customer_phone` desde la cuenta del
    tenant. Devuelve True si el envío logró ejecutarse (no garantiza entrega).

    Patrón:
      1. Carga provider + credentials_encrypted del tenant.
      2. Descifra credentials.
      3. Instancia adapter (Whapi/Meta/Twilio según provider).
      4. Llama adapter.enviar_mensaje(customer_phone, body).
    """
    if not customer_phone or not body or len(body.strip()) < 1:
        logger.warning(
            "enviar_a_cliente skipped: missing phone or body",
            extra={"event": "send_skipped", "tenant_id": str(tenant_id)},
        )
        return False

    pool = await inicializar_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT pc.provider, pc.credentials_encrypted
            FROM provider_credentials pc
            WHERE pc.tenant_id = $1
            """,
            tenant_id,
        )

    if not row or not row["provider"]:
        logger.warning(
            "enviar_a_cliente sin provider_credentials",
            extra={"event": "send_no_creds", "tenant_id": str(tenant_id)},
        )
        return False

    creds: dict[str, Any] = {}
    if row["credentials_encrypted"]:
        try:
            creds = json.loads(descifrar(row["credentials_encrypted"]))
        except Exception:
            logger.exception(
                "enviar_a_cliente desciframiento falló",
                extra={"event": "send_decrypt_error", "tenant_id": str(tenant_id)},
            )
            return False

    try:
        adapter = obtener_proveedor(row["provider"], creds, "")
        await adapter.enviar_mensaje(customer_phone, body)
        logger.info(
            "mensaje proactivo enviado",
            extra={
                "event": "proactive_msg_sent",
                "tenant_id": str(tenant_id),
                "phone_tail": customer_phone[-4:],
                "provider": row["provider"],
            },
        )
        return True
    except Exception:
        logger.exception(
            "enviar_a_cliente adapter falló",
            extra={"event": "send_adapter_error", "tenant_id": str(tenant_id)},
        )
        return False


# ── Mensajes formateados para el workflow cocina ↔ cliente (mig 027) ─────────


def fmt_eta_propuesta(business_name: str, eta_minutes: int, total_eur: float | None = None) -> str:
    """Mensaje cuando cocina acepta el pedido y propone tiempo de preparación."""
    parts = [
        f"¡Tu pedido fue ACEPTADO ✓ por {business_name}.",
        f"Tiempo de preparación: {eta_minutes} minutos.",
    ]
    if total_eur is not None:
        parts.append(f"Total: {total_eur:.2f} €")
    parts.append("¿De acuerdo con este tiempo? Responde *sí* para confirmar o *no* para cancelar.")
    return "\n".join(parts)


def fmt_rechazo_kitchen(business_name: str, reason_key: str, detail: str | None) -> str:
    """Mensaje cuando cocina rechaza el pedido. Si es out_of_stock, sugerimos
    al bot pregunte por sustitución (el bot lo procesa en el siguiente turno
    al detectar contexto)."""
    intros = {
        "closing_soon": "Lo sentimos, la cocina está cerrando y no llegamos a preparar tu pedido a tiempo.",
        "too_busy": "Lo sentimos, en este momento tenemos demasiada demanda y no podemos aceptar tu pedido.",
        "kitchen_problem": "Lo sentimos, hay un problema técnico en cocina y no podemos preparar tu pedido ahora.",
        "temporarily_unavailable": (
            f"Lo sentimos, el producto «{detail}» no está disponible en este momento."
            if detail else "Lo sentimos, uno de los productos no está disponible."
        ),
        "out_of_stock": (
            f"Lo sentimos, se nos ha agotado «{detail}». ¿Quieres cambiarlo por otra cosa de la carta?"
            if detail else "Lo sentimos, se nos ha agotado uno de los productos. ¿Quieres cambiarlo por otra cosa?"
        ),
        "other": detail or "Lo sentimos, no podemos aceptar tu pedido en este momento.",
    }
    intro = intros.get(reason_key, intros["other"])
    if reason_key in ("out_of_stock", "temporarily_unavailable", "other"):
        # Estos casos ya cierran con pregunta o explicación específica.
        return f"{intro}\n\n— {business_name}"
    # Para rechazos generales, ofrecemos disculpa + invitación a volver a intentar.
    return (
        f"{intro}\n"
        "Por favor inténtalo de nuevo en otro momento o llama directamente al local.\n\n"
        f"— {business_name}"
    )
