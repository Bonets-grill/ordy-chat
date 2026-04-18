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

import asyncio
import hmac
import logging
import os
from contextlib import asynccontextmanager
from uuid import UUID

from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.responses import PlainTextResponse

from app.brain import generar_respuesta
from app.logging_config import configurar_logging
from app.memory import (
    cerrar_pool,
    guardar_intercambio,
    inicializar_pool,
    obtener_historial,
    ya_procesado,
)
from app.onboarding_scraper import ejecutar_scrape
from app.validator.runner import ejecutar_validator
from app.outbound_throttle import esperar_con_warmup, esperar_turno
from app.providers import MensajeEntrante, obtener_proveedor
from app.rate_limit import limite_superado
from app.renderer import cerrar_browser, renderizar
from app.tenants import (
    TenantContext,
    TenantInactive,
    TenantNotFound,
    cargar_tenant_por_slug,
)


def _check_internal_secret(request: Request) -> None:
    """Valida x-internal-secret con hmac.compare_digest (timing-safe).
    Raises HTTPException 403 si no coincide.
    """
    shared = os.getenv("RUNTIME_INTERNAL_SECRET", "")
    provided = request.headers.get("x-internal-secret", "")
    if not shared or not provided or not hmac.compare_digest(provided, shared):
        raise HTTPException(status_code=403, detail="invalid internal secret")

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


app = FastAPI(title="Ordy Chat Runtime", version="1.2.0", lifespan=lifespan)


@app.get("/")
async def health():
    return {"service": "ordy-chat-runtime", "status": "ok"}


# ────────────────────────────────────────────────────────────
# /render — Playwright headless para SPAs. Usado por el scraper del web.
# Autenticación por header compartido RUNTIME_INTERNAL_SECRET.
# ────────────────────────────────────────────────────────────

@app.post("/render")
async def render_endpoint(request: Request):
    _check_internal_secret(request)

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


# ────────────────────────────────────────────────────────────
# /onboarding/scrape — fire-and-forget. La web llama aquí y el worker
# corre en background actualizando onboarding_jobs en DB.
# ────────────────────────────────────────────────────────────

@app.post("/onboarding/scrape", status_code=202)
async def onboarding_scrape_endpoint(request: Request):
    _check_internal_secret(request)

    body = await request.json()
    job_id_raw = (body or {}).get("job_id")
    urls = (body or {}).get("urls") or {}
    if not job_id_raw:
        raise HTTPException(status_code=400, detail="job_id requerido")
    try:
        job_id = UUID(str(job_id_raw))
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="job_id no es UUID")
    if not isinstance(urls, dict):
        raise HTTPException(status_code=400, detail="urls debe ser objeto")

    # asyncio.create_task (NO BackgroundTasks) para desacoplar del request
    # y que el scrape (~30s) sobreviva aunque el cliente cierre la conexión.
    asyncio.create_task(ejecutar_scrape(job_id, urls))
    return {"status": "accepted", "job_id": str(job_id)}


# ────────────────────────────────────────────────────────────
# /internal/validator/run-seeds — dispara el validador de agentes.
# Rate-limit 3/hora/tenant solo para triggered_by='admin_manual'.
# onboarding_auto y autopatch_retry son triggers sistema, sin limit.
# ────────────────────────────────────────────────────────────

_VALIDATOR_TRIGGERS = {"onboarding_auto", "admin_manual", "autopatch_retry"}


@app.post("/internal/validator/run-seeds", status_code=202)
async def internal_validator_run_seeds(request: Request):
    _check_internal_secret(request)

    body = await request.json()
    tenant_id_raw = (body or {}).get("tenant_id")
    triggered_by = (body or {}).get("triggered_by", "admin_manual")

    if not tenant_id_raw:
        raise HTTPException(status_code=400, detail="tenant_id requerido")
    try:
        tenant_id = UUID(str(tenant_id_raw))
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="tenant_id no es UUID")
    if triggered_by not in _VALIDATOR_TRIGGERS:
        raise HTTPException(
            status_code=400,
            detail=f"triggered_by inválido. Permitidos: {sorted(_VALIDATOR_TRIGGERS)}",
        )

    # Rate-limit SOLO para admin_manual (onboarding_auto/autopatch_retry son sistema).
    if triggered_by == "admin_manual":
        pool = await inicializar_pool()
        async with pool.acquire() as conn:
            recent = await conn.fetchval(
                """
                SELECT count(*)::int
                FROM validator_runs
                WHERE tenant_id = $1
                  AND triggered_by = 'admin_manual'
                  AND created_at > now() - interval '1 hour'
                """,
                tenant_id,
            )
        if (recent or 0) >= 3:
            logger.warning(
                "validator rate limit",
                extra={
                    "event": "validator_rate_limit",
                    "tenant_id": str(tenant_id),
                    "recent_manual_runs": recent,
                },
            )
            raise HTTPException(
                status_code=429,
                detail={
                    "error": "rate_limit",
                    "message": "Máximo 3 runs manuales por hora por tenant.",
                    "retry_after_seconds": 3600,
                },
            )

    # Fire-and-forget: el run toma ~40s, no bloquear al caller.
    asyncio.create_task(ejecutar_validator(tenant_id, triggered_by))
    return {"status": "accepted", "tenant_id": str(tenant_id), "triggered_by": triggered_by}


# ────────────────────────────────────────────────────────────
# /internal/jobs/reap — watchdog. Disparado cada minuto por Vercel Cron
# para marcar como failed los jobs cuyo deadline expiró sin terminar.
# ────────────────────────────────────────────────────────────

@app.get("/internal/jobs/reap")
async def internal_jobs_reap(request: Request):
    _check_internal_secret(request)

    pool = await inicializar_pool()
    async with pool.acquire() as conn:
        result = await conn.execute(
            """
            UPDATE onboarding_jobs
            SET status = 'failed',
                error = COALESCE(error, 'deadline_exceeded'),
                updated_at = now()
            WHERE status IN ('pending', 'scraping', 'sources_ready', 'confirming')
              AND scrape_deadline_at IS NOT NULL
              AND scrape_deadline_at < now()
            """
        )
    # asyncpg .execute() devuelve "UPDATE N" string.
    return {"status": "ok", "swept": result}


# ────────────────────────────────────────────────────────────
# /internal/jobs/purge-results — retention RGPD. Vercel Cron diario.
# Limpia result_json de onboarding_jobs > 30 días para minimizar PII.
# ────────────────────────────────────────────────────────────

@app.get("/internal/jobs/purge-results")
async def internal_jobs_purge_results(request: Request):
    _check_internal_secret(request)

    pool = await inicializar_pool()
    async with pool.acquire() as conn:
        result = await conn.execute(
            """
            UPDATE onboarding_jobs
            SET result_json = NULL, updated_at = now()
            WHERE result_json IS NOT NULL
              AND created_at < now() - interval '30 days'
            """
        )
    return {"status": "ok", "purged": result}


# ────────────────────────────────────────────────────────────
# /internal/health/evolution-all — healthcheck de instancias Evolution.
# Llamado cada 10 min desde Vercel Cron. Marca burned=true las que caen.
# ────────────────────────────────────────────────────────────

@app.get("/internal/health/evolution-all")
async def internal_health_evolution_all(request: Request):
    _check_internal_secret(request)

    from app.tenants import cargar_tenant_por_slug  # import lazy
    pool = await inicializar_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT t.slug, pc.tenant_id, pc.credentials_encrypted, pc.webhook_secret
            FROM provider_credentials pc
            JOIN tenants t ON t.id = pc.tenant_id
            WHERE pc.provider = 'evolution' AND pc.burned = false
            """
        )

    checked = 0
    burned = 0
    errors: list[dict] = []

    for row in rows:
        slug = row["slug"]
        try:
            tenant = await cargar_tenant_por_slug(slug)
        except Exception as e:
            errors.append({"slug": slug, "error": f"load_tenant: {str(e)[:120]}"})
            continue

        adapter = obtener_proveedor("evolution", tenant.credentials, tenant.webhook_secret)
        try:
            health = await adapter.healthcheck_instancia()
        except Exception as e:
            errors.append({"slug": slug, "error": f"healthcheck: {str(e)[:120]}"})
            continue

        checked += 1
        state = (health or {}).get("state")
        if state == "close":
            async with pool.acquire() as c2:
                await c2.execute(
                    """
                    UPDATE provider_credentials
                    SET burned = true,
                        burned_at = now(),
                        burned_reason = 'disconnected'
                    WHERE tenant_id = $1 AND burned = false
                    """,
                    row["tenant_id"],
                )
            burned += 1
            logger.warning(
                "evolution instance burned",
                extra={"event": "instance_burned", "slug": slug, "state": state},
            )

    return {
        "status": "ok",
        "checked": checked,
        "burned": burned,
        "errors_count": len(errors),
        "errors": errors[:20],  # limite log
    }


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

        # Media entrante: si es imagen y podemos descargarla, la pasamos a Claude como
        # content block. Para otros tipos (audio, video, etc.) seguimos respondiendo
        # que solo leemos texto e imagen por ahora (audio llegará en futura iteración
        # con Whisper/AssemblyAI).
        media_blocks: list[dict] = []
        caption_text = ""
        if msg.tipo_no_texto:
            if msg.tipo_no_texto == "image" and msg.media_ref:
                downloaded = await adapter.descargar_media(msg.media_ref)
                if downloaded is not None:
                    raw_bytes, mime = downloaded
                    # Claude acepta jpeg, png, gif, webp < 5MB por imagen.
                    if mime.startswith("image/") and len(raw_bytes) <= 5 * 1024 * 1024:
                        import base64 as _b64
                        media_blocks.append({
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": mime if mime in ("image/jpeg", "image/png", "image/gif", "image/webp") else "image/jpeg",
                                "data": _b64.b64encode(raw_bytes).decode("ascii"),
                            },
                        })
                        caption_text = (msg.caption or "").strip()
                        logger.info(
                            "image recibida",
                            extra={**log_extra, "event": "image_in", "size": len(raw_bytes), "mime": mime},
                        )
            if not media_blocks:
                # No pudimos procesar la media — respondemos amablemente.
                respuesta = (
                    f"Recibí tu {msg.tipo_no_texto}, pero por ahora solo sé leer texto "
                    "e imágenes. ¿Podrías escribirme lo que necesitas?"
                )
                estado = await esperar_con_warmup(tenant.id, msg.telefono)
                if not estado.get("blocked"):
                    await adapter.enviar_mensaje(msg.telefono, respuesta)
                logger.info("media no soportada", extra={**log_extra, "event": "media_skip"})
                return

        if not media_blocks and (not msg.texto or len(msg.texto.strip()) < 1):
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
        # Texto efectivo: si hay imagen con caption, usamos el caption como prompt.
        texto_efectivo = msg.texto if msg.texto else caption_text
        respuesta, tin, tout = await generar_respuesta(
            tenant,
            texto_efectivo,
            historial,
            customer_phone=msg.telefono,
            media_blocks=media_blocks or None,
        )

        await guardar_intercambio(
            tenant.id, msg.telefono, msg.texto, respuesta,
            mensaje_id=msg.mensaje_id, tokens_in=tin, tokens_out=tout,
        )

        # Anti-ban combinado: warmup daily cap + jitter 0.8-2.0s + presence typing.
        estado = await esperar_con_warmup(tenant.id, msg.telefono)
        if estado.get("blocked"):
            logger.warning(
                "warmup cap hit",
                extra={**log_extra, "event": "warmup_cap_hit",
                       "tier": estado.get("tier"), "cap": estado.get("cap"),
                       "sent_today": estado.get("sent_today")},
            )
            # Solo en fase "fresh" (día 1-3) avisamos al cliente. Días 4+
            # silenciosos para no exponer el cap del warmup al usuario final.
            if estado.get("tier") == "fresh":
                try:
                    await adapter.enviar_mensaje(
                        msg.telefono,
                        "He llegado al límite de mensajes por hoy. Mañana retomamos. "
                        "Gracias por tu paciencia.",
                    )
                except Exception:
                    logger.exception("fallo enviando aviso warmup",
                                     extra={**log_extra, "event": "warmup_notice_fail"})
            return

        waited = estado.get("waited", 0.0)
        if waited > 0:
            logger.debug(
                "outbound throttled",
                extra={**log_extra, "event": "outbound_wait", "waited_ms": int(waited * 1000)},
            )

        # Presence "escribiendo…" 1-2s antes del mensaje real (solo Evolution).
        import random as _rnd
        try:
            await adapter.enviar_presence_typing(
                msg.telefono, duracion_ms=_rnd.randint(800, 2000),
            )
            await asyncio.sleep(0.3)
        except Exception:
            # Presence es nice-to-have; no bloquea el envío.
            pass

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
