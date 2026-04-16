# runtime/app/main.py — Servidor FastAPI multi-tenant.
#
# Endpoint por tenant: POST /webhook/{provider}/{tenant_slug}
# El tenant configura ESA URL en el dashboard de su proveedor de WhatsApp.

import logging
import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import PlainTextResponse

from app.brain import generar_respuesta
from app.memory import cerrar_pool, guardar_intercambio, inicializar_pool, obtener_historial
from app.providers import obtener_proveedor
from app.tenants import (
    TenantInactive,
    TenantNotFound,
    cargar_tenant_por_slug,
)

load_dotenv()

log_level = logging.DEBUG if os.getenv("ENVIRONMENT") == "development" else logging.INFO
logging.basicConfig(level=log_level, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("ordychat")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await inicializar_pool()
    logger.info("Ordy Chat runtime listo")
    yield
    await cerrar_pool()


app = FastAPI(title="Ordy Chat Runtime", version="1.0.0", lifespan=lifespan)


@app.get("/")
async def health():
    return {"service": "ordy-chat-runtime", "status": "ok"}


@app.get("/webhook/{provider}/{tenant_slug}")
async def webhook_get(provider: str, tenant_slug: str, request: Request):
    """Verificación GET (Meta). Otros proveedores devuelven 200 simple."""
    try:
        tenant = await cargar_tenant_por_slug(tenant_slug)
    except TenantNotFound:
        raise HTTPException(status_code=404, detail="tenant not found")
    except TenantInactive as e:
        raise HTTPException(status_code=402, detail=str(e))

    adapter = obtener_proveedor(provider, tenant.credentials)
    resultado = await adapter.validar_webhook(request)
    if resultado is not None:
        return PlainTextResponse(str(resultado))
    return {"status": "ok"}


@app.post("/webhook/{provider}/{tenant_slug}")
async def webhook_post(provider: str, tenant_slug: str, request: Request):
    """Recibe mensajes, genera respuesta y responde por el mismo proveedor."""
    try:
        tenant = await cargar_tenant_por_slug(tenant_slug)
    except TenantNotFound:
        raise HTTPException(status_code=404, detail="tenant not found")
    except TenantInactive as e:
        logger.warning("tenant inactivo: %s", e)
        return {"status": "inactive"}

    if tenant.paused:
        return {"status": "paused"}

    adapter = obtener_proveedor(provider, tenant.credentials)
    mensajes = await adapter.parsear_webhook(request)

    for msg in mensajes:
        if msg.es_propio or not msg.texto:
            continue
        try:
            historial = await obtener_historial(tenant.id, msg.telefono)
            respuesta, tin, tout = await generar_respuesta(tenant, msg.texto, historial)
            await guardar_intercambio(
                tenant.id, msg.telefono, msg.texto, respuesta, tin, tout
            )
            await adapter.enviar_mensaje(msg.telefono, respuesta)
            logger.info("tenant=%s phone=%s ok", tenant.slug, msg.telefono)
        except Exception as e:
            logger.exception("tenant=%s error procesando: %s", tenant.slug, e)

    return {"status": "ok"}
