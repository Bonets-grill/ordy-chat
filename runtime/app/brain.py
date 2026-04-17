# runtime/app/brain.py — Respuestas con Claude. Cliente singleton + prompt caching + tool use.

import json
import logging
from typing import Any

from anthropic import AsyncAnthropic, APIStatusError, APIConnectionError

from app.ordering import crear_pedido, obtener_link_pago
from app.tenants import TenantContext, obtener_anthropic_api_key

logger = logging.getLogger("ordychat.brain")

MODEL_ID = "claude-sonnet-4-6"
MAX_TOKENS = 1024
MAX_TOOL_ITERATIONS = 4  # protege contra bucles; un pedido típico usa 1-2

# Cache de clientes por api_key. El SDK ya hace retries internos (max_retries=3).
_client_cache: dict[str, AsyncAnthropic] = {}


def _get_client(api_key: str) -> AsyncAnthropic:
    cached = _client_cache.get(api_key)
    if cached is not None:
        return cached
    client = AsyncAnthropic(api_key=api_key, max_retries=3, timeout=60.0)
    _client_cache[api_key] = client
    return client


# ── Tools expuestas a Claude ───────────────────────────────────────
TOOLS: list[dict[str, Any]] = [
    {
        "name": "crear_pedido",
        "description": (
            "Crea un pedido (factura simplificada) para un comensal del restaurante y "
            "devuelve un enlace de pago de Stripe que el cliente puede abrir en su móvil. "
            "ÚSALO solo cuando el cliente ha confirmado los productos que quiere, NO para "
            "preguntas sobre la carta, sugerencias o pedidos a medias. Extrae precios del "
            "menú del restaurante que tienes en tu contexto. Si no estás seguro de un precio, "
            "pregunta al cliente antes de llamar la tool."
        ),
        "input_schema": {
            "type": "object",
            "required": ["items"],
            "properties": {
                "items": {
                    "type": "array",
                    "minItems": 1,
                    "description": "Líneas del pedido",
                    "items": {
                        "type": "object",
                        "required": ["name", "quantity", "unit_price_cents"],
                        "properties": {
                            "name": {"type": "string", "description": "Nombre del producto"},
                            "quantity": {"type": "integer", "minimum": 1},
                            "unit_price_cents": {
                                "type": "integer",
                                "minimum": 0,
                                "description": "Precio por unidad SIN IVA en céntimos (10€ = 1000)",
                            },
                            "vat_rate": {
                                "type": "number",
                                "description": "IVA aplicable (10 hostelería, 21 alcohol). Omite para usar el default del tenant.",
                            },
                            "notes": {"type": "string", "description": "Aclaraciones: sin sal, bien hecho, etc."},
                        },
                    },
                },
                "table_number": {"type": "string", "description": "Número de mesa si el cliente lo mencionó"},
                "customer_name": {"type": "string", "description": "Nombre del cliente si lo conoces"},
                "notes": {"type": "string", "description": "Nota general para el pedido"},
            },
        },
    }
]


async def _ejecutar_tool(
    tenant: TenantContext, tool_name: str, tool_input: dict[str, Any], customer_phone: str
) -> str:
    """Ejecuta una tool solicitada por Claude y devuelve el resultado serializable."""
    if tool_name == "crear_pedido":
        try:
            order = await crear_pedido(
                tenant_slug=tenant.slug,
                items=tool_input.get("items", []),
                customer_phone=customer_phone,
                customer_name=tool_input.get("customer_name"),
                table_number=tool_input.get("table_number"),
                notes=tool_input.get("notes"),
            )
            link = await obtener_link_pago(order["orderId"])
            total_eur = order["totalCents"] / 100
            return json.dumps({
                "ok": True,
                "order_id": order["orderId"],
                "total_eur": total_eur,
                "currency": order["currency"],
                "payment_url": link["url"],
            })
        except Exception as e:
            logger.exception(
                "tool crear_pedido falló",
                extra={"tenant_slug": tenant.slug, "event": "tool_error", "tool": tool_name},
            )
            return json.dumps({"ok": False, "error": str(e)[:300]})
    return json.dumps({"ok": False, "error": f"tool desconocida: {tool_name}"})


async def generar_respuesta(
    tenant: TenantContext,
    mensaje_usuario: str,
    historial: list[dict],
    customer_phone: str = "",
) -> tuple[str, int, int]:
    """
    Devuelve (respuesta, tokens_in, tokens_out).
    Implementa tool-use loop para permitir a Claude crear pedidos.
    """
    texto_limpio = (mensaje_usuario or "").strip()
    if len(texto_limpio) < 2:
        return tenant.fallback_message, 0, 0

    if len(texto_limpio) > 8000:
        texto_limpio = texto_limpio[:8000]

    try:
        api_key = await obtener_anthropic_api_key(tenant.credentials)
    except Exception as e:
        logger.error(
            "no hay api_key disponible",
            extra={"tenant_slug": tenant.slug, "event": "api_key_missing"},
            exc_info=e,
        )
        return tenant.error_message, 0, 0

    client = _get_client(api_key)

    # El historial ya viene normalizado (role/content). Anthropic content blocks
    # legacy (strings) siguen siendo válidos — aquí los dejamos como user/assistant
    # de texto puro para mantener compatibilidad.
    messages: list[dict[str, Any]] = [
        {"role": m["role"], "content": m["content"]} for m in historial
    ]
    messages.append({"role": "user", "content": texto_limpio})

    total_in = 0
    total_out = 0

    try:
        for _ in range(MAX_TOOL_ITERATIONS):
            resp = await client.messages.create(
                model=MODEL_ID,
                max_tokens=MAX_TOKENS,
                system=[
                    {
                        "type": "text",
                        "text": tenant.system_prompt,
                        "cache_control": {"type": "ephemeral"},
                    }
                ],
                messages=messages,
                tools=TOOLS,
            )
            total_in += resp.usage.input_tokens
            total_out += resp.usage.output_tokens

            if resp.stop_reason != "tool_use":
                # Respuesta final — extraer texto de todos los bloques text.
                texto_final = "".join(
                    block.text for block in resp.content if getattr(block, "type", None) == "text"
                ).strip()
                return texto_final or tenant.error_message, total_in, total_out

            # Claude pidió una tool. Registrar el assistant turn completo y ejecutar.
            messages.append({"role": "assistant", "content": resp.content})

            tool_results: list[dict[str, Any]] = []
            for block in resp.content:
                if getattr(block, "type", None) == "tool_use":
                    resultado = await _ejecutar_tool(tenant, block.name, block.input, customer_phone)
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": resultado,
                    })
            messages.append({"role": "user", "content": tool_results})
        # Se acabaron las iteraciones sin respuesta final.
        logger.warning(
            "tool loop agotó iteraciones",
            extra={"tenant_slug": tenant.slug, "event": "tool_loop_exhausted"},
        )
        return tenant.error_message, total_in, total_out
    except (APIStatusError, APIConnectionError) as e:
        logger.error(
            "claude api error",
            extra={"tenant_slug": tenant.slug, "event": "claude_error"},
            exc_info=e,
        )
        return tenant.error_message, total_in, total_out
    except Exception:
        logger.exception(
            "error inesperado en claude",
            extra={"tenant_slug": tenant.slug, "event": "claude_unexpected"},
        )
        return tenant.error_message, total_in, total_out
