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
from datetime import datetime, timezone
from uuid import UUID

from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.responses import PlainTextResponse

from app.admin_resolver import manejar_admin_flow
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


# Dedupe in-memory de avisos de warmup al tenant humano: {tenant_id_str: "YYYY-MM-DD"}.
# Una notificación por tenant por día. Si reinicia el proceso, una notificación
# extra en el día no es spam. Si hace falta durabilidad futura, migrar a DB.
_warmup_notify_cache: dict[str, str] = {}
_warmup_notify_lock = asyncio.Lock()

# Dedupe independiente de avisos "cerca del cap" (umbral 80%). Mismo patrón
# que _warmup_notify_cache: 1 aviso/día/tenant. La clave incluye el umbral
# para que si cambiamos el threshold (futura config) no colisionemos.
_warmup_warn_cache: dict[str, str] = {}
_warmup_warn_lock = asyncio.Lock()

WARMUP_WARN_THRESHOLD = 0.8  # aviso temprano cuando sent_today/cap >= 0.8


async def _notificar_tenant_warmup_cap(
    tenant: TenantContext,
    adapter,
    estado: dict,
) -> None:
    """Manda WhatsApp al humano del tenant avisando que el bot se ha
    silenciado por warmup. Dedupe por tenant+día (máx 1 notificación/día).

    El cliente final NUNCA recibe aviso — exponer el cap del warmup era
    detalle técnico que erosionaba confianza. En su lugar, el humano del
    tenant puede atender manualmente desde su WhatsApp hasta el reset
    diario del cap o hasta que se active un `warmup_override`.
    """
    pool = await inicializar_pool()
    async with pool.acquire() as conn:
        target_phone = await conn.fetchval(
            "SELECT handoff_whatsapp_phone FROM agent_configs WHERE tenant_id = $1",
            tenant.id,
        )
    target_phone = (target_phone or "").strip()
    if not target_phone:
        return

    today = datetime.now(timezone.utc).date().isoformat()
    async with _warmup_notify_lock:
        if _warmup_notify_cache.get(str(tenant.id)) == today:
            return
        _warmup_notify_cache[str(tenant.id)] = today

    tier = estado.get("tier") or "?"
    cap = estado.get("cap") or 0
    sent = estado.get("sent_today") or 0
    body = (
        f"⚠️ *Warmup cap alcanzado* — {tenant.name}\n\n"
        f"Tu bot de WhatsApp se ha silenciado por protección anti-ban "
        f"(tier {tier}, {sent}/{cap} mensajes hoy).\n\n"
        f"Mientras tanto, responde manualmente a tus clientes desde WhatsApp. "
        f"El bot volverá mañana con el cap renovado.\n\n"
        f"Si tu volumen real es alto, pide al administrador de la plataforma "
        f"que active warmup_override para tu cuenta."
    )
    try:
        await adapter.enviar_mensaje(target_phone, body)
        logger.info(
            "warmup notify tenant enviado",
            extra={
                "event": "warmup_notify_tenant",
                "tenant_id": str(tenant.id),
                "target_phone_tail": target_phone[-4:],
                "tier": tier,
                "cap": cap,
                "sent_today": sent,
            },
        )
    except Exception:
        logger.exception(
            "warmup notify tenant falló",
            extra={"event": "warmup_notify_tenant_error", "tenant_id": str(tenant.id)},
        )


async def _avisar_tenant_warmup_cerca(
    tenant: TenantContext,
    adapter,
    estado: dict,
) -> None:
    """Aviso temprano cuando sent_today/cap >= WARMUP_WARN_THRESHOLD.

    Mismo patrón de dedupe que `_notificar_tenant_warmup_cap` pero con
    caché independiente: un tenant que hoy se acerque al cap y luego
    lo alcance recibe DOS mensajes distintos (80% → cap hit), no uno.
    Eso es a propósito: el aviso temprano permite reaccionar con
    warmup_override antes de que el bot se silencie.

    Se llama SIEMPRE después de un mensaje enviado con éxito (no bloqueado)
    para que el humano del tenant pueda actuar mientras el bot sigue vivo.
    """
    cap = estado.get("cap")
    sent = estado.get("sent_today")
    if cap is None or sent is None or cap <= 0:
        return  # override activo, mature, o provider no-evolution → no aplica
    ratio = sent / cap
    if ratio < WARMUP_WARN_THRESHOLD:
        return

    pool = await inicializar_pool()
    async with pool.acquire() as conn:
        target_phone = await conn.fetchval(
            "SELECT handoff_whatsapp_phone FROM agent_configs WHERE tenant_id = $1",
            tenant.id,
        )
    target_phone = (target_phone or "").strip()
    if not target_phone:
        return

    today = datetime.now(timezone.utc).date().isoformat()
    async with _warmup_warn_lock:
        if _warmup_warn_cache.get(str(tenant.id)) == today:
            return
        _warmup_warn_cache[str(tenant.id)] = today

    tier = estado.get("tier") or "?"
    restantes = cap - sent
    body = (
        f"🟡 *Cerca del cap diario* — {tenant.name}\n\n"
        f"Tu bot ha enviado {sent}/{cap} mensajes hoy (tier {tier}, "
        f"{int(ratio * 100)}% del cap). Quedan {restantes} antes de silenciarse.\n\n"
        f"Si esperas más tráfico, pide al administrador activar "
        f"warmup_override antes de alcanzar el límite."
    )
    try:
        await adapter.enviar_mensaje(target_phone, body)
        logger.info(
            "warmup warn tenant enviado",
            extra={
                "event": "warmup_warn_tenant",
                "tenant_id": str(tenant.id),
                "target_phone_tail": target_phone[-4:],
                "tier": tier,
                "cap": cap,
                "sent_today": sent,
                "ratio": round(ratio, 2),
            },
        )
    except Exception:
        logger.exception(
            "warmup warn tenant falló",
            extra={"event": "warmup_warn_tenant_error", "tenant_id": str(tenant.id)},
        )


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


@app.get("/version")
async def version():
    """
    Devuelve commit SHA actual + feature flags de runtime importantes.
    Útil para verificar qué revisión está desplegada en Railway.
    Variables de entorno RAILWAY_GIT_COMMIT_SHA las inyecta Railway solo;
    fallback a os.getenv('GIT_SHA') o 'unknown'.
    """
    import os
    sha = (
        os.getenv("RAILWAY_GIT_COMMIT_SHA")
        or os.getenv("GIT_SHA")
        or "unknown"
    )
    return {
        "service": "ordy-chat-runtime",
        "commit": sha[:12] if sha != "unknown" else sha,
        "features": {
            # Flags para que el deploy verifique que el código nuevo está vivo.
            "now_block": True,       # brain.py _build_now_block (inyecta fecha/tz/día)
            "schedule_rules": True,  # <horario> con reglas innegociables
            "crear_cita_guards": True,  # rechaza pasado/>90d en agent_tools
            "tenant_timezone": True,  # columna tenants.timezone migration 014
        },
    }


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


@app.post("/internal/learning/run")
async def internal_learning_run(request: Request):
    """Dispara el ciclo de auto-aprendizaje para un tenant o para todos.

    Body: {"tenant_id": "<uuid>"} → solo ese tenant (pruebas manuales)
          {"all": true}          → todos los tenants activos (cron diario)
          {"force": true}        → ignora cooldown de 20h (solo para pruebas)
    """
    _check_internal_secret(request)

    body = await request.json() if request.headers.get("content-length") else {}
    body = body or {}
    tenant_id_raw = body.get("tenant_id")
    run_all = bool(body.get("all"))
    force = bool(body.get("force"))

    from app.learning.learn_from_chats import learn_for_tenant

    if run_all:
        pool = await inicializar_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT id FROM tenants WHERE subscription_status IN ('active', 'trialing')"
            )
        results = []
        for r in rows:
            try:
                res = await learn_for_tenant(r["id"], force=force)
                results.append({"tenant_id": str(r["id"]), **res})
            except Exception as e:
                logger.exception(
                    "learning fallo por tenant",
                    extra={"event": "learning_tenant_error", "tenant_id": str(r["id"])},
                )
                results.append({"tenant_id": str(r["id"]), "ok": False, "reason": f"exception:{type(e).__name__}"})
        return {"status": "done", "tenants": len(results), "results": results}

    if not tenant_id_raw:
        raise HTTPException(status_code=400, detail="tenant_id requerido (o all=true)")
    try:
        tenant_id = UUID(str(tenant_id_raw))
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="tenant_id no es UUID")
    res = await learn_for_tenant(tenant_id, force=force)
    return {"status": "done", "tenant_id": str(tenant_id), **res}


@app.post("/internal/playground/generate")
async def internal_playground_generate(request: Request):
    """Ejecuta brain.generar_respuesta con el sistema prompt real del tenant
    pero SIN escribir a conversations/messages y SIN enviar a WhatsApp.
    Uso: /dashboard/playground del tenant para probar el agente.

    Body: {"tenant_slug": str, "messages": [{"role": "user"|"assistant", "content": str}]}
    Devuelve: {"response": str, "tokens_in": int, "tokens_out": int}
    """
    _check_internal_secret(request)

    body = await request.json()
    tenant_slug = (body or {}).get("tenant_slug")
    messages = (body or {}).get("messages") or []
    if not tenant_slug:
        raise HTTPException(status_code=400, detail="tenant_slug requerido")
    if not isinstance(messages, list) or not messages:
        raise HTTPException(status_code=400, detail="messages debe ser lista no vacía")
    if len(messages) > 40:
        raise HTTPException(status_code=400, detail="máximo 40 mensajes de historial")

    # Última user message es la que respondemos; resto es historial.
    last = messages[-1]
    if not isinstance(last, dict) or last.get("role") != "user":
        raise HTTPException(status_code=400, detail="último mensaje debe ser role=user")
    user_text = str(last.get("content", "")).strip()
    if len(user_text) < 1 or len(user_text) > 4000:
        raise HTTPException(status_code=400, detail="content vacío o >4000 chars")

    historial = [
        {"role": m["role"], "content": m["content"]}
        for m in messages[:-1]
        if isinstance(m, dict) and m.get("role") in ("user", "assistant")
    ]

    from app.brain import generar_respuesta
    from app.tenants import cargar_tenant_por_slug

    try:
        tenant = await cargar_tenant_por_slug(tenant_slug)
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"tenant: {type(e).__name__}")

    try:
        respuesta, tin, tout = await generar_respuesta(
            tenant,
            user_text,
            historial,
            customer_phone="playground-sandbox",
            media_blocks=None,
            sandbox=True,
        )
    except Exception as e:
        logger.exception(
            "playground generate error",
            extra={"event": "playground_error", "tenant_slug": tenant_slug},
        )
        raise HTTPException(status_code=502, detail=f"brain: {type(e).__name__}")

    return {"response": respuesta, "tokens_in": tin, "tokens_out": tout}


@app.post("/internal/orders/notify-eta-accepted")
async def internal_orders_notify_eta_accepted(request: Request):
    """Llamado por web tras cocina aceptar un pedido en /api/kds/accept.
    Envía WA al cliente con la propuesta de ETA + pregunta confirmación.
    Body: {tenant_id, customer_phone, eta_minutes, business_name, total_eur?}
    """
    _check_internal_secret(request)
    body = await request.json() or {}
    try:
        tenant_id = UUID(str(body.get("tenant_id")))
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="tenant_id inválido")
    customer_phone = str(body.get("customer_phone", "")).strip()
    eta_minutes = body.get("eta_minutes")
    business_name = str(body.get("business_name", "")).strip() or "tu pedido"
    total_eur = body.get("total_eur")
    if not customer_phone or not isinstance(eta_minutes, int) or eta_minutes < 5 or eta_minutes > 120:
        raise HTTPException(status_code=400, detail="customer_phone + eta_minutes (5-120) requeridos")

    from app.messaging import enviar_a_cliente, fmt_eta_propuesta

    msg = fmt_eta_propuesta(business_name, int(eta_minutes), float(total_eur) if total_eur is not None else None)
    sent = await enviar_a_cliente(tenant_id, customer_phone, msg)
    return {"ok": True, "sent": sent}


@app.post("/internal/orders/notify-rejection")
async def internal_orders_notify_rejection(request: Request):
    """Llamado por web tras cocina rechazar un pedido en /api/kds/reject.
    Envía WA al cliente con la razón. Si reason_key=out_of_stock, el bot en el
    siguiente turno detectará el contexto y propondrá sustitución (Fase 6).
    Body: {tenant_id, customer_phone, reason_key, detail?, business_name}
    """
    _check_internal_secret(request)
    body = await request.json() or {}
    try:
        tenant_id = UUID(str(body.get("tenant_id")))
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="tenant_id inválido")
    customer_phone = str(body.get("customer_phone", "")).strip()
    reason_key = str(body.get("reason_key", "")).strip()
    detail = body.get("detail")
    business_name = str(body.get("business_name", "")).strip() or "el restaurante"
    valid_keys = {"closing_soon", "too_busy", "out_of_stock", "temporarily_unavailable", "kitchen_problem", "other"}
    if not customer_phone or reason_key not in valid_keys:
        raise HTTPException(status_code=400, detail=f"customer_phone + reason_key (in {sorted(valid_keys)}) requeridos")

    from app.messaging import enviar_a_cliente, fmt_rechazo_kitchen

    msg = fmt_rechazo_kitchen(business_name, reason_key, detail if isinstance(detail, str) and detail.strip() else None)
    sent = await enviar_a_cliente(tenant_id, customer_phone, msg)
    return {"ok": True, "sent": sent}


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
            # Audio / voice note (PPT) → Whisper transcripción → tratar como texto.
            # C4 2026-04-20: permite al admin y al cliente mandar audios. Evolution
            # entrega audio/ogg;codecs=opus. Whisper API lo acepta directo <=25MB.
            if msg.tipo_no_texto in ("audio", "voice") and msg.media_ref:
                from app.audio import (
                    AudioTooLargeError,
                    OpenAIKeyMissingError,
                    obtener_openai_api_key,
                    transcribir_audio,
                )
                downloaded = await adapter.descargar_media(msg.media_ref)
                if downloaded is not None:
                    raw_bytes, mime = downloaded
                    try:
                        oai_key = await obtener_openai_api_key(tenant.credentials)
                        transcripcion = await transcribir_audio(raw_bytes, mime, oai_key)
                    except AudioTooLargeError:
                        transcripcion = None
                        _user_err = (
                            "El audio es demasiado largo (>25 MB). "
                            "¿Puedes mandar uno más corto o escribirlo?"
                        )
                    except OpenAIKeyMissingError:
                        logger.error(
                            "OPENAI_API_KEY ausente — audio no procesable",
                            extra={**log_extra, "event": "audio_no_key"},
                        )
                        transcripcion = None
                        _user_err = "No puedo procesar audios todavía. ¿Puedes escribirlo?"
                    except Exception:
                        logger.exception(
                            "whisper fallo transcripción",
                            extra={**log_extra, "event": "audio_whisper_error", "bytes": len(raw_bytes), "mime": mime},
                        )
                        transcripcion = None
                        _user_err = "No pude entender tu audio. ¿Puedes repetirlo o escribirlo?"

                    if transcripcion:
                        # La transcripción reemplaza el texto del mensaje. El resto
                        # del flujo (admin flow / cliente flow) lo usa como si el
                        # user hubiera escrito directamente.
                        msg.texto = transcripcion
                        logger.info(
                            "audio→texto OK",
                            extra={**log_extra, "event": "audio_transcribed", "chars": len(transcripcion)},
                        )
                    else:
                        # Sin transcripción utilizable → responder amable y return.
                        estado = await esperar_con_warmup(tenant.id, msg.telefono)
                        if not estado.get("blocked"):
                            await adapter.enviar_mensaje(msg.telefono, _user_err)
                        return
                else:
                    logger.warning(
                        "no se pudo descargar audio",
                        extra={**log_extra, "event": "audio_download_fail"},
                    )
                    await adapter.enviar_mensaje(
                        msg.telefono,
                        "No pude descargar tu audio. ¿Puedes volver a mandarlo o escribirlo?",
                    )
                    return
            elif msg.tipo_no_texto == "image" and msg.media_ref:
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
            if not media_blocks and not msg.texto:
                # No pudimos procesar la media Y no hay texto rescatable (la rama
                # audio/voice rellena msg.texto con la transcripción Whisper; ese
                # caso NO debe caer aquí). Llegamos aquí solo para video/document/
                # sticker o imagen que no se pudo descargar.
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

        # ── Admin mode (C4 2026-04-20) ────────────────────────────────
        # Si el remitente está en tenant_admins de este tenant, el flow
        # admin toma el mensaje (PIN, auth, placeholder tools) y no llamamos
        # al LLM cliente. Los mensajes admin NO pasan por warmup/anti-ban
        # porque son esporádicos y no arriesgan baneo de WhatsApp.
        pool = await inicializar_pool()
        admin_took = await manejar_admin_flow(
            pool,
            tenant,
            msg.telefono,
            texto_efectivo,
            msg.mensaje_id,
            enviar=adapter.enviar_mensaje,
        )
        if admin_took:
            logger.info(
                "admin flow tomó el mensaje",
                extra={**log_extra, "event": "admin_handled"},
            )
            return

        # ── Handoff check (C4 tanda 3c) ───────────────────────────────
        # Si esta conversación cliente<->bot está pausada por un admin,
        # el bot NO responde. Guardamos el mensaje del cliente para que
        # aparezca en el historial (y el admin pueda leerlo), pero ni
        # LLM ni anti-ban se ejecutan.
        async with pool.acquire() as _c:
            pausada = await _c.fetchrow(
                "SELECT 1 FROM paused_conversations WHERE tenant_id = $1 AND customer_phone = $2",
                tenant.id, msg.telefono,
            )
        if pausada:
            try:
                await guardar_intercambio(
                    tenant.id, msg.telefono, msg.texto, "",
                    mensaje_id=msg.mensaje_id, tokens_in=0, tokens_out=0,
                )
            except Exception:
                logger.exception(
                    "no se pudo guardar mensaje en conversación pausada",
                    extra={**log_extra, "event": "paused_save_error"},
                )
            logger.info(
                "conversación pausada — bot silenciado",
                extra={**log_extra, "event": "conv_paused_skip"},
            )
            return

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
            # El cliente NUNCA recibe aviso (exponerle el cap del warmup es
            # detalle técnico que erosiona confianza y parece bot roto).
            # En su lugar notificamos UNA vez al día al humano del tenant
            # para que atienda manualmente.
            try:
                await _notificar_tenant_warmup_cap(tenant, adapter, estado)
            except Exception:
                logger.exception(
                    "warmup notify tenant wrapper falló",
                    extra={**log_extra, "event": "warmup_tenant_notify_wrap_error"},
                )
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

        # Aviso temprano al humano del tenant cuando nos acercamos al cap
        # diario. Best-effort: si falla, NUNCA afecta al envío real al
        # cliente que acaba de completarse.
        try:
            await _avisar_tenant_warmup_cerca(tenant, adapter, estado)
        except Exception:
            logger.exception(
                "warmup warn wrapper falló",
                extra={**log_extra, "event": "warmup_warn_wrap_error"},
            )

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
