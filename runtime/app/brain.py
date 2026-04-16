# runtime/app/brain.py — Genera respuestas con Claude usando el system_prompt del tenant.

import logging
from anthropic import AsyncAnthropic

from app.tenants import TenantContext, obtener_anthropic_api_key

logger = logging.getLogger("ordychat.brain")

MODEL_ID = "claude-sonnet-4-6"
MAX_TOKENS = 1024


async def generar_respuesta(
    tenant: TenantContext,
    mensaje_usuario: str,
    historial: list[dict],
) -> tuple[str, int, int]:
    """
    Devuelve (respuesta, tokens_in, tokens_out).
    Si el mensaje está vacío/trivial, responde con fallback sin llamar a la API.
    """
    if not mensaje_usuario or len(mensaje_usuario.strip()) < 2:
        return tenant.fallback_message, 0, 0

    try:
        api_key = await obtener_anthropic_api_key(tenant.credentials)
    except Exception as e:
        logger.error("No hay api_key para tenant=%s: %s", tenant.slug, e)
        return tenant.error_message, 0, 0

    client = AsyncAnthropic(api_key=api_key)

    messages = [{"role": m["role"], "content": m["content"]} for m in historial]
    messages.append({"role": "user", "content": mensaje_usuario})

    try:
        resp = await client.messages.create(
            model=MODEL_ID,
            max_tokens=MAX_TOKENS,
            system=tenant.system_prompt,
            messages=messages,
        )
        texto = resp.content[0].text if resp.content else tenant.error_message
        tokens_in = resp.usage.input_tokens
        tokens_out = resp.usage.output_tokens
        logger.info(
            "tenant=%s tokens_in=%d tokens_out=%d", tenant.slug, tokens_in, tokens_out
        )
        return texto, tokens_in, tokens_out
    except Exception as e:
        logger.error("Claude API error tenant=%s: %s", tenant.slug, e)
        return tenant.error_message, 0, 0
