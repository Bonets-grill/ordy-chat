# runtime/app/main.py — Servidor FastAPI multi-tenant con procesamiento en background.
#
# Endpoint: POST /webhook/{provider}/{tenant_slug}
# El tenant configura ESA URL (con su webhook_secret) en el dashboard del proveedor.
#
# Flujo por request:
#   1. Cargar tenant (rápido).
#   2. Verificar firma del webhook (403 si falla).
#   3. Parsear mensajes entrantes.
#   4. Responder 200 INMEDIATAMENTE.
#   5. Procesar cada mensaje en background (dedupe → rate limit → Claude → enviar).

import logging
import os
from contextlib import asynccontextmanager
from uuid import UUID

from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.responses import PlainTextResponse

from app.brain import generar_respuesta
from app.logging_config import configurar_logging
from app.memory import cerrar_pool, guardar_intercambio, inicializar_pool, obtener_historial, ya_procesado
from app.providers import MensajeEntrante, obtener_proveedor
from app.rate_limit import limite_superado
from app.renderer import cerrar_browser, renderizar
from app.tenants import (
    TenantContext,
    TenantInactive,
    TenantNotFound,
    cargar_tenant_por_slug,
)

load_dotenv()
configurar_logging()
logger = logging.getLogger("ordychat.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await inicializar_pool()
    logger.info("runtime listo", extra={"event": "startup"})
    yield
    await cerrar_browser()
    await cerrar_pool()


app = FastAPI(title="Ordy Chat Runtime", version="1.1.0", lifespan=lifespan)


@app.get("/")
async def health():
    return {"service": "ordy-chat-runtime", "status": "ok"}


# ────────────────────────────────────────────────────────────
# /render — Playwright headless para SPAs. Usado por el scraper del web.
# Autenticación por header compartido RUNTIME_INTERNAL_SECRET.
# ────────────────────────────────────────────────────────────

@app.post("/render")
async def render_endpoint(request: Request):
    shared_secret = os.getenv("RUNTIME_INTERNAL_SECRET", "")
    provided = request.headers.get("x-internal-secret", "")
    if not shared_secret or provided != shared_secret:
        raise HTTPException(status_code=403, detail="invalid internal secret")

    body = await request.json()
    url = (body or {}).get("url", "")
    timeout_ms = int((body or {}).get("timeoutMs") or 25_000)
    if not url or not url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="invalid url")

    try:
        result = await renderizar(url, timeout_ms)
        return {"ok": True, **result}
    except Exception as e:
        logger.exception("render failed: %s", url)
        raise HTTPException(status_code=502, detail=f"render_error: {e}") from e


@app.get("/webhook/{provider}/{tenant_slug}")
async def webhook_get(provider: str, tenant_slug: str, request: Request):
    try:
        tenant = await cargar_tenant_por_slug(tenant_slug)
    except TenantNotFound:
        raise HTTPException(status_code=404, detail="tenant not found")
    except TenantInactive as e:
        raise HTTPException(status_code=402, detail=str(e))

    adapter = obtener_proveedor(provider, tenant.credentials, tenant.webhook_secret)
    resultado = await adapter.validar_webhook_get(request)
    if resultado is not None:
        return PlainTextResponse(str(resultado))
    return {"status": "ok"}


@app.post("/webhook/{provider}/{tenant_slug}")
async def webhook_post(
    provider: str,
    tenant_slug: str,
    request: Request,
    background_tasks: BackgroundTasks,
):
    try:
        tenant = await cargar_tenant_por_slug(tenant_slug)
    except TenantNotFound:
        raise HTTPException(status_code=404, detail="tenant not found")
    except TenantInactive as e:
        logger.warning(
            "tenant inactivo",
            extra={"tenant_slug": tenant_slug, "event": "tenant_inactive"},
        )
        # Devolver 200 para que el proveedor no retry agresivo.
        return {"status": "inactive", "reason": str(e)}

    if tenant.paused:
        return {"status": "paused"}

    body_bytes = await request.body()
    adapter = obtener_proveedor(provider, tenant.credentials, tenant.webhook_secret)

    if not await adapter.verificar_firma(request, body_bytes):
        logger.warning(
            "firma inválida",
            extra={"tenant_slug": tenant_slug, "provider": provider, "event": "bad_signature"},
        )
        raise HTTPException(status_code=403, detail="invalid signature")

    mensajes = await adapter.parsear_webhook(request, body_bytes)

    for msg in mensajes:
        if msg.es_propio:
            continue
        background_tasks.add_task(_procesar_mensaje, tenant, provider, msg)

    return {"status": "ok", "queued": len(mensajes)}


# ────────────────────────────────────────────────────────────
# Procesamiento asíncrono de un mensaje individual.
# ────────────────────────────────────────────────────────────

async def _procesar_mensaje(tenant: TenantContext, provider: str, msg: MensajeEntrante) -> None:
    from time import perf_counter
    t0 = perf_counter()
    log_extra = {
        "tenant_slug": tenant.slug,
        "phone": msg.telefono,
        "mensaje_id": msg.mensaje_id,
        "provider": provider,
    }

    try:
        # Dedupe atómico por (tenant_id, mensaje_id).
        if await ya_procesado(tenant.id, msg.mensaje_id):
            logger.info("mensaje duplicado — skip", extra={**log_extra, "event": "dup_skip"})
            return

        # Recargar adapter con httpx client cacheado.
        adapter = obtener_proveedor(provider, tenant.credentials, tenant.webhook_secret)

        # Media no soportada → responder amablemente y registrar.
        if msg.tipo_no_texto:
            respuesta = (
                f"Recibí tu {msg.tipo_no_texto}, pero por ahora solo sé leer mensajes de texto. "
                "¿Podrías escribirme lo que necesitas?"
            )
            await adapter.enviar_mensaje(msg.telefono, respuesta)
            logger.info("media no soportada", extra={**log_extra, "event": "media_skip"})
            return

        if not msg.texto or len(msg.texto.strip()) < 1:
            return

        # Rate limit por tenant.
        if await limite_superado(tenant.id, tenant.max_messages_per_hour):
            logger.warning(
                "rate limit superado",
                extra={**log_extra, "event": "rate_limited"},
            )
            await adapter.enviar_mensaje(
                msg.telefono,
                "Estamos recibiendo muchos mensajes justo ahora. Dame un momento y te respondo.",
            )
            return

        historial = await obtener_historial(tenant.id, msg.telefono)
        respuesta, tin, tout = await generar_respuesta(tenant, msg.texto, historial)

        await guardar_intercambio(
            tenant.id, msg.telefono, msg.texto, respuesta,
            mensaje_id=msg.mensaje_id, tokens_in=tin, tokens_out=tout,
        )
        await adapter.enviar_mensaje(msg.telefono, respuesta)

        logger.info(
            "mensaje procesado",
            extra={
                **log_extra,
                "event": "msg_ok",
                "tokens_in": tin,
                "tokens_out": tout,
                "duration_ms": int((perf_counter() - t0) * 1000),
            },
        )
    except Exception:
        logger.exception("error procesando mensaje", extra={**log_extra, "event": "msg_error"})
