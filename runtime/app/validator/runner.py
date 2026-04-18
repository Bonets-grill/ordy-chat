# runtime/app/validator/runner.py — Orquestador del validador.
#
# Pipeline:
#   1. Resolver tenant_id → slug → cargar TenantContext.
#   2. Detectar nicho y cargar 20 seeds (8 universal + 12 nicho).
#   3. crear_run status='running'.
#   4. asyncio.Semaphore(5) + asyncio.gather: para cada seed ejecuta
#      brain → asserts → judge → persist.
#   5. Agregar verdicts → summary.
#   6. Si FAIL crítico + autopatch_attempts < 1: autopatch + recursive.
#   7. Si re-FAIL post-autopatch: pause agent + notify-fail web.
#   8. cerrar_run.

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Literal
from uuid import UUID

import httpx

from app.brain import generar_respuesta
from app.memory import inicializar_pool
from app.tenants import cargar_tenant_por_slug, obtener_anthropic_api_key
from app.validator.asserts import evaluate_asserts
from app.validator.autopatch import generar_prompt_mejorado
from app.validator.judge import judge_respuesta
from app.validator.persist import (
    aplicar_autopatch,
    cerrar_run,
    crear_run,
    guardar_mensaje,
    marcar_agente_pausado,
)
from app.validator.seeds import Nicho, Seed, cargar_seeds, detectar_nicho

logger = logging.getLogger("ordychat.validator.runner")

VALIDATOR_PHONE = "+00000VALIDATOR"
GATHER_SEMAPHORE = 5
ASSERT_CRITICAL_KEYS = ("idioma_ok", "no_filtra_prompt", "no_falsa_promesa_pago")
JUDGE_SCORE_MAX = 40  # 4 dims × 10
JUDGE_REVIEW_THRESHOLD = 33  # <33/40 + asserts OK → review
JUDGE_FAIL_THRESHOLD = 20   # <20/40 → fail judge


async def _resolver_slug(tenant_id: UUID) -> str | None:
    pool = await inicializar_pool()
    async with pool.acquire() as conn:
        return await conn.fetchval(
            "SELECT slug FROM tenants WHERE id = $1", tenant_id,
        )


async def _resolver_validation_mode(
    tenant_id: UUID,
) -> Literal["auto", "manual", "skip"]:
    """Resuelve modo efectivo de validación. Sprint 3 validador-ui F6.

    Orden de precedencia:
      1. agent_configs.validation_mode (override por tenant).
      2. platform_settings 'flag.validation_mode_default' (flag global).
      3. Fallback 'skip' (seguro por defecto).
    """
    pool = await inicializar_pool()
    async with pool.acquire() as conn:
        override = await conn.fetchval(
            "SELECT validation_mode FROM agent_configs WHERE tenant_id = $1",
            tenant_id,
        )
    if override in ("auto", "manual", "skip"):
        return override  # type: ignore[return-value]

    # Flag global cifrada en platform_settings.
    async with pool.acquire() as conn:
        raw = await conn.fetchval(
            "SELECT value_encrypted FROM platform_settings "
            "WHERE key = 'flag.validation_mode_default'",
        )
    if raw:
        try:
            from app.crypto import descifrar  # import diferido

            parsed = json.loads(descifrar(raw))
            if parsed in ("auto", "manual", "skip"):
                return parsed  # type: ignore[return-value]
        except Exception:
            logger.warning(
                "flag validation_mode_default corrupta, fallback skip",
                extra={"event": "validator_flag_corrupt"},
            )
    return "skip"


def _evaluar_verdict(asserts_result: dict[str, bool], scores: dict[str, int]) -> str:
    """Combina asserts + scores en un verdict pass|review|fail.

    - FAIL: cualquier assert crítico roto OR total_score < JUDGE_FAIL_THRESHOLD.
    - REVIEW: asserts OK pero total_score < JUDGE_REVIEW_THRESHOLD.
    - PASS: asserts OK y total_score >= JUDGE_REVIEW_THRESHOLD.
    """
    if any(asserts_result.get(k) is False for k in ASSERT_CRITICAL_KEYS):
        return "fail"
    total = sum(scores.get(k, 0) for k in ("tono", "menciona_negocio", "tool_correcta", "no_inventa"))
    if total < JUDGE_FAIL_THRESHOLD:
        return "fail"
    if total < JUDGE_REVIEW_THRESHOLD:
        return "review"
    return "pass"


async def _evaluar_seed(
    seed: Seed,
    tenant,
    api_key: str,
    tenant_accept_online_payment: bool,
    sem: asyncio.Semaphore,
    run_id: UUID,
) -> dict[str, Any]:
    """Ejecuta una semilla contra el bot + judge + persist. Retorna resumen
    {verdict, asserts, scores, notes, duration_ms, tokens_in/out, seed_id}."""
    async with sem:
        t0 = time.perf_counter()
        try:
            respuesta, tin, tout = await generar_respuesta(
                tenant,
                seed.text,
                [],
                customer_phone=VALIDATOR_PHONE,
                media_blocks=None,
            )
        except Exception as e:
            logger.exception(
                "brain falló en seed",
                extra={"event": "seed_brain_error", "seed_id": seed.id},
            )
            respuesta = ""
            tin, tout = 0, 0
            # Asserts todas False para FAIL.
            asserts_result = {k: False for k in ASSERT_CRITICAL_KEYS}
            scores = {k: 0 for k in ("tono", "menciona_negocio", "tool_correcta", "no_inventa")}
            notes = f"brain_error: {str(e)[:150]}"
            verdict = "fail"
            duration_ms = int((time.perf_counter() - t0) * 1000)
            await guardar_mensaje(
                run_id=run_id,
                tenant_id=tenant.id,
                seed={"id": seed.id, "text": seed.text, "expected_action": seed.expected_action},
                response_text=respuesta,
                tools_called=[],
                asserts_result=asserts_result,
                judge_scores=scores,
                judge_notes=notes,
                verdict=verdict,
                tokens_in=tin,
                tokens_out=tout,
                duration_ms=duration_ms,
            )
            return {
                "seed_id": seed.id, "verdict": verdict, "asserts": asserts_result,
                "scores": scores, "notes": notes, "duration_ms": duration_ms,
                "seed_text": seed.text, "response_text": respuesta,
            }

        # Asserts deterministas
        asserts_result = dict(evaluate_asserts(
            seed_text=seed.text,
            seed_locale=seed.locale,
            response_text=respuesta,
            tenant_accept_online_payment=tenant_accept_online_payment,
            tenant_system_prompt=tenant.system_prompt,
        ))

        # Judge LLM
        judge = await judge_respuesta(
            api_key=api_key,
            seed_text=seed.text,
            expected_action=seed.expected_action,
            response_text=respuesta,
            tools_called=[],  # brain.generar_respuesta no expone tools usadas — extensión futura
            asserts_result=asserts_result,
            agent_config_tone=tenant.tone if hasattr(tenant, "tone") else "friendly",
            agent_config_business_name=tenant.business_name if hasattr(tenant, "business_name") else "",
        )

        scores = dict(judge["scores"])
        verdict = _evaluar_verdict(asserts_result, scores)
        duration_ms = int((time.perf_counter() - t0) * 1000)
        total_tokens_in = tin + judge["tokens_in"]
        total_tokens_out = tout + judge["tokens_out"]

        await guardar_mensaje(
            run_id=run_id,
            tenant_id=tenant.id,
            seed={"id": seed.id, "text": seed.text, "expected_action": seed.expected_action},
            response_text=respuesta,
            tools_called=[],
            asserts_result=asserts_result,
            judge_scores=scores,
            judge_notes=judge["notes"],
            verdict=verdict,
            tokens_in=total_tokens_in,
            tokens_out=total_tokens_out,
            duration_ms=duration_ms,
        )

        return {
            "seed_id": seed.id,
            "verdict": verdict,
            "asserts": asserts_result,
            "scores": scores,
            "notes": judge["notes"],
            "duration_ms": duration_ms,
            "seed_text": seed.text,
            "response_text": respuesta,
        }


def _agregar_summary(results: list[dict[str, Any]]) -> dict[str, Any]:
    total = len(results)
    passed = sum(1 for r in results if r["verdict"] == "pass")
    review = sum(1 for r in results if r["verdict"] == "review")
    failed = sum(1 for r in results if r["verdict"] == "fail")
    asserts_sum = {k: 0 for k in ASSERT_CRITICAL_KEYS}
    for r in results:
        for k in ASSERT_CRITICAL_KEYS:
            if r["asserts"].get(k) is False:
                asserts_sum[k] += 1
    scores_total = {"tono": 0, "menciona_negocio": 0, "tool_correcta": 0, "no_inventa": 0}
    for r in results:
        for k in scores_total:
            scores_total[k] += r["scores"].get(k, 0)
    scores_avg = {k: (v / max(total, 1)) for k, v in scores_total.items()}

    return {
        "total": total,
        "passed": passed,
        "review": review,
        "failed": failed,
        "asserts_critical_fails": asserts_sum,
        "scores_avg": scores_avg,
        "avg_duration_ms": int(sum(r["duration_ms"] for r in results) / max(total, 1)),
    }


def _tiene_fallo_critico(results: list[dict[str, Any]]) -> bool:
    """True si ≥1 seed tiene assert crítico roto."""
    for r in results:
        if any(r["asserts"].get(k) is False for k in ASSERT_CRITICAL_KEYS):
            return True
    return False


def _determinar_status(results: list[dict[str, Any]]) -> str:
    if _tiene_fallo_critico(results):
        return "fail"
    # Sin asserts crít rotos → basado en verdicts.
    if any(r["verdict"] == "fail" for r in results):
        return "fail"
    if any(r["verdict"] == "review" for r in results):
        return "review"
    return "pass"


async def _notificar_fail_web(run_id: UUID, tenant_id: UUID, reasons: list[str]) -> None:
    """POST web /api/internal/validator/notify-fail — fire-and-forget."""
    web_url = (os.getenv("WEB_URL") or os.getenv("NEXT_PUBLIC_APP_URL") or "").replace("/", "").rstrip("/")
    # Normalizar — WEB_URL suele venir tipo "https://x.com".
    web_url = (os.getenv("WEB_URL") or os.getenv("NEXT_PUBLIC_APP_URL") or "").rstrip("/")
    secret = os.getenv("RUNTIME_INTERNAL_SECRET", "")
    if not web_url or not secret:
        logger.warning(
            "notify-fail skipped: WEB_URL/RUNTIME_INTERNAL_SECRET ausentes",
            extra={"event": "notify_fail_no_config", "run_id": str(run_id)},
        )
        return
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(
                f"{web_url}/api/internal/validator/notify-fail",
                headers={"Content-Type": "application/json", "x-internal-secret": secret},
                json={
                    "run_id": str(run_id),
                    "tenant_id": str(tenant_id),
                    "reasons": reasons[:20],
                },
            )
    except Exception as e:
        logger.error(
            "notify-fail http error",
            extra={"event": "notify_fail_error", "error": str(e)[:200]},
        )


def _extraer_razones_fails(results: list[dict[str, Any]]) -> list[str]:
    razones: list[str] = []
    for r in results:
        if r["verdict"] == "fail":
            motivos = []
            for k in ASSERT_CRITICAL_KEYS:
                if r["asserts"].get(k) is False:
                    motivos.append(f"{k}=false")
            if not motivos:
                total = sum(r["scores"].get(k, 0) for k in ("tono", "menciona_negocio", "tool_correcta", "no_inventa"))
                motivos.append(f"judge_score={total}/40")
            razones.append(f"seed={r['seed_id']}: {', '.join(motivos)}")
    return razones


async def ejecutar_validator(
    tenant_id: UUID,
    triggered_by: str = "onboarding_auto",
) -> UUID | None:
    """Orquestador principal. Retorna run_id o None si no pudo arrancar.
    Fire-and-forget desde endpoint — no propaga excepciones al caller."""
    try:
        # 1. Resolver tenant
        slug = await _resolver_slug(tenant_id)
        if not slug:
            logger.error(
                "tenant no existe",
                extra={"event": "validator_tenant_missing", "tenant_id": str(tenant_id)},
            )
            return None

        # 1bis. Resolver validation_mode efectivo (Sprint 3 F6).
        # 'skip' corta al inicio salvo que el admin lo haya disparado a mano.
        effective_mode = await _resolver_validation_mode(tenant_id)
        if effective_mode == "skip" and triggered_by != "admin_manual":
            logger.info(
                "validator skip por modo efectivo",
                extra={
                    "event": "validator_mode_skip",
                    "tenant_id": str(tenant_id),
                    "tenant_slug": slug,
                    "triggered_by": triggered_by,
                },
            )
            return None

        tenant = await cargar_tenant_por_slug(slug)
        api_key = await obtener_anthropic_api_key(tenant.credentials)

        # 2. Detectar nicho + cargar seeds
        business_description = getattr(tenant, "business_description", "") or ""
        categories = getattr(tenant, "categories", []) or []
        category_names = [c.get("name", "") for c in categories if isinstance(c, dict)]
        nicho: Nicho = detectar_nicho(business_description, category_names)
        seeds = cargar_seeds(nicho)

        # 3. crear_run
        run_id = await crear_run(tenant_id, triggered_by, nicho)
        logger.info(
            "validator run iniciado",
            extra={
                "event": "validator_run_start",
                "run_id": str(run_id),
                "tenant_slug": slug,
                "nicho": nicho,
                "n_seeds": len(seeds),
                "triggered_by": triggered_by,
            },
        )

        # 4. Ejecutar seeds en paralelo con Semaphore(5)
        accept_online = bool(getattr(tenant, "accept_online_payment", False))
        sem = asyncio.Semaphore(GATHER_SEMAPHORE)
        results = await asyncio.gather(
            *[_evaluar_seed(s, tenant, api_key, accept_online, sem, run_id) for s in seeds],
            return_exceptions=False,
        )

        # 5. Summary + verdict
        summary = _agregar_summary(results)
        status = _determinar_status(results)

        # 6. Autopatch si FAIL crítico y attempts < 1
        autopatch_attempts = 0
        autopatch_applied_at = None
        previous_prompt = None
        paused_by_this_run = False

        # Gate F6: autopatch SOLO en modo 'auto'. 'manual' nunca dispara
        # autopatch (humano decide) y 'admin_manual' en modo manual tampoco.
        autopatch_allowed = effective_mode == "auto"

        if (
            autopatch_allowed
            and status == "fail"
            and triggered_by != "autopatch_retry"
        ):
            fails_for_patch = [
                {
                    "seed_text": r["seed_text"],
                    "response_text": r["response_text"],
                    "razon": ", ".join(
                        k for k in ASSERT_CRITICAL_KEYS if r["asserts"].get(k) is False
                    ) or "judge_low_score",
                }
                for r in results if r["verdict"] == "fail"
            ]
            nuevo_prompt = await generar_prompt_mejorado(
                api_key=api_key,
                system_prompt_actual=tenant.system_prompt,
                fails=fails_for_patch,
                business_name=getattr(tenant, "business_name", "") or slug,
            )
            if nuevo_prompt:
                previous_prompt = tenant.system_prompt
                await aplicar_autopatch(tenant_id, nuevo_prompt, previous_prompt)
                autopatch_attempts = 1
                autopatch_applied_at = datetime.now(timezone.utc)
                logger.info(
                    "autopatch aplicado, reintentando",
                    extra={
                        "event": "validator_autopatch_applied",
                        "run_id": str(run_id),
                        "delta_chars": len(nuevo_prompt) - len(previous_prompt),
                    },
                )
                # Cierre del run actual con status intermedio 'fail' + metadata
                await cerrar_run(
                    run_id=run_id,
                    tenant_id=tenant_id,
                    status=status,
                    summary=summary,
                    autopatch_attempts=autopatch_attempts,
                    autopatch_applied_at=autopatch_applied_at,
                    previous_system_prompt=previous_prompt,
                    paused_by_this_run=False,
                )
                # Recursive run con triggered_by='autopatch_retry'
                return await ejecutar_validator(tenant_id, triggered_by="autopatch_retry")

        # 6bis. GATE F6: en modo 'manual', cualquier fail se degrada a 'review'
        # para bloquear el pause + notify-fail + autopatch del paso 7. El
        # humano decide desde la UI admin. Aplicar ANTES de cualquier efecto
        # lateral (pause/notify) que el bloque 7 pudiera causar.
        if effective_mode == "manual" and status == "fail":
            logger.info(
                "gate manual: fail → review",
                extra={
                    "event": "validator_manual_gate_downgrade",
                    "run_id": str(run_id),
                    "tenant_id": str(tenant_id),
                },
            )
            status = "review"

        # 7. Si es autopatch_retry y sigue fail → pause + notify.
        # El gate F6 ya garantiza que 'manual' NUNCA llega aquí como 'fail'.
        if status == "fail" and triggered_by == "autopatch_retry":
            await marcar_agente_pausado(tenant_id, razon="validator_fail_post_autopatch")
            paused_by_this_run = True
            reasons = _extraer_razones_fails(results)
            await _notificar_fail_web(run_id, tenant_id, reasons)

        # 8. cerrar_run final
        await cerrar_run(
            run_id=run_id,
            tenant_id=tenant_id,
            status=status,
            summary=summary,
            autopatch_attempts=autopatch_attempts,
            autopatch_applied_at=autopatch_applied_at,
            previous_system_prompt=previous_prompt,
            paused_by_this_run=paused_by_this_run,
        )

        logger.info(
            "validator run completado",
            extra={
                "event": "validator_run_done",
                "run_id": str(run_id),
                "status": status,
                "summary": summary,
                "paused": paused_by_this_run,
            },
        )
        return run_id

    except Exception:
        logger.exception(
            "validator runner error fatal",
            extra={"event": "validator_runner_fatal", "tenant_id": str(tenant_id)},
        )
        return None
