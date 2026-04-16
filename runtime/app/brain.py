# runtime/app/brain.py — Respuestas con Claude. Cliente singleton + prompt caching.

import logging
from anthropic import AsyncAnthropic, APIStatusError, APIConnectionError

from app.tenants import TenantContext, obtener_anthropic_api_key

logger = logging.getLogger("ordychat.brain")

MODEL_ID = "claude-sonnet-4-6"
MAX_TOKENS = 1024

# Cache de clientes por api_key. El SDK ya hace retries internos (max_retries=3).
_client_cache: dict[str, AsyncAnthropic] = {}


def _get_client(api_key: str) -> AsyncAnthropic:
    cached = _client_cache.get(api_key)
    if cached is not None:
        return cached
    client = AsyncAnthropic(api_key=api_key, max_retries=3, timeout=60.0)
    _client_cache[api_key] = client
    return client


async def generar_respuesta(
    tenant: TenantContext,
    mensaje_usuario: str,
    historial: list[dict],
) -> tuple[str, int, int]:
    """
    Devuelve (respuesta, tokens_in, tokens_out).
    Fallback si mensaje trivial. error_message del tenant si falla la API.
    """
    texto_limpio = (mensaje_usuario or "").strip()
    if len(texto_limpio) < 2:
        return tenant.fallback_message, 0, 0

    # Límite defensivo — evitar que un usuario envíe 1MB en un mensaje.
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

    messages = [{"role": m["role"], "content": m["content"]} for m in historial]
    messages.append({"role": "user", "content": texto_limpio})

    try:
        resp = await client.messages.create(
            model=MODEL_ID,
            max_tokens=MAX_TOKENS,
            # Prompt caching: el system_prompt del tenant puede ser largo y rara vez cambia.
            # cache_control "ephemeral" (TTL 5 min) ahorra ~80% de input tokens en
            # conversaciones activas con múltiples turnos.
            system=[
                {
                    "type": "text",
                    "text": tenant.system_prompt,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            messages=messages,
        )
    except (APIStatusError, APIConnectionError) as e:
        logger.error(
            "claude api error",
            extra={"tenant_slug": tenant.slug, "event": "claude_error"},
            exc_info=e,
        )
        return tenant.error_message, 0, 0
    except Exception as e:
        logger.exception(
            "error inesperado en claude",
            extra={"tenant_slug": tenant.slug, "event": "claude_unexpected"},
        )
        return tenant.error_message, 0, 0

    texto = resp.content[0].text if resp.content else tenant.error_message
    tokens_in = resp.usage.input_tokens
    tokens_out = resp.usage.output_tokens

    logger.info(
        "respuesta generada",
        extra={
            "tenant_slug": tenant.slug,
            "tokens_in": tokens_in,
            "tokens_out": tokens_out,
            "event": "claude_ok",
        },
    )
    return texto, tokens_in, tokens_out
