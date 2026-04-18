# runtime/app/onboarding_scraper.py — Worker de scraping del onboarding fast.
#
# Llamado como fire-and-forget desde POST /onboarding/scrape del runtime
# (definido en fase 6). Lee URLs del job, valida cada una con es_url_publica
# (anti-SSRF), scrapea en paralelo con Playwright (importa renderizar directo
# para evitar HTTP self-call), guarda el HTML crudo en onboarding_jobs.result_json
# y pasa el job a status='sources_ready'. El merger LLM vive en web/ — este
# worker solo produce las fuentes crudas.
#
# IMPORTANTE: este archivo NO debe lanzar excepciones al caller. Todo error va
# al job como status='failed' + error text.

import asyncio
import json
import logging
import os
from typing import Any
from uuid import UUID

from app.memory import inicializar_pool
from app.renderer import renderizar
from app.url_safety import es_url_publica

logger = logging.getLogger("ordychat.onboarding_scraper")

DEFAULT_TIMEOUT_SEC = int(os.getenv("ONBOARDING_SCRAPE_MAX_SEC", "45"))
PER_URL_TIMEOUT_MS = 25_000


async def ejecutar_scrape(job_id: UUID, urls: dict[str, str | None]) -> None:
    """
    Pipeline:
      1. UPDATE status='scraping' + scrape_started_at + scrape_deadline_at.
      2. Por cada URL no-vacía, validar SSRF + renderizar en paralelo.
      3. asyncio.wait_for con timeout global = DEFAULT_TIMEOUT_SEC.
      4. UPDATE status='sources_ready' + result_json={sources:[{origin,url,ok,html?,error?}]}
         o 'failed' + error='scrape_timeout' si expira.
    """
    pool = await inicializar_pool()

    try:
        async with pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE onboarding_jobs
                SET status = 'scraping',
                    scrape_started_at = now(),
                    scrape_deadline_at = now() + make_interval(secs => $2),
                    updated_at = now()
                WHERE id = $1 AND status = 'pending'
                """,
                job_id, DEFAULT_TIMEOUT_SEC,
            )

        sources = await asyncio.wait_for(
            _scrape_paralelo(urls),
            timeout=DEFAULT_TIMEOUT_SEC,
        )

        async with pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE onboarding_jobs
                SET status = 'sources_ready',
                    result_json = $2::jsonb,
                    updated_at = now()
                WHERE id = $1
                """,
                job_id, json.dumps({"sources": sources}),
            )
        logger.info(
            "scrape completado",
            extra={
                "event": "scrape_ok",
                "job_id": str(job_id),
                "n_sources": len(sources),
                "n_ok": sum(1 for s in sources if s.get("ok")),
            },
        )
    except asyncio.TimeoutError:
        await _marcar_failed(pool, job_id, "scrape_timeout")
    except Exception as e:
        logger.exception(
            "error en scrape",
            extra={"job_id": str(job_id), "event": "scrape_error"},
        )
        await _marcar_failed(pool, job_id, f"unexpected: {str(e)[:280]}")


async def _marcar_failed(pool, job_id: UUID, error: str) -> None:
    try:
        async with pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE onboarding_jobs
                SET status = 'failed', error = $2, updated_at = now()
                WHERE id = $1
                """,
                job_id, error,
            )
    except Exception:
        logger.exception(
            "no pude marcar failed",
            extra={"job_id": str(job_id), "event": "scrape_mark_failed_error"},
        )


async def _scrape_paralelo(urls: dict[str, str | None]) -> list[dict[str, Any]]:
    tareas = []
    for origin, url in urls.items():
        if not url or not isinstance(url, str):
            continue
        tareas.append(_scrape_una(origin, url))
    if not tareas:
        return []
    # return_exceptions=False porque _scrape_una captura internamente.
    return await asyncio.gather(*tareas, return_exceptions=False)


async def _scrape_una(origin: str, url: str) -> dict[str, Any]:
    """Scrape individual. Nunca lanza — captura toda excepción como source.ok=False."""
    ok, reason = await es_url_publica(url)
    if not ok:
        logger.warning(
            "url rechazada por SSRF guard",
            extra={"event": "scrape_ssrf_block", "origin": origin, "reason": reason},
        )
        return {"origin": origin, "url": url, "ok": False, "error": f"ssrf_blocked: {reason}"}

    try:
        result = await renderizar(url, PER_URL_TIMEOUT_MS)
        return {
            "origin": origin,
            "url": url,
            "ok": True,
            "html": result.get("html", ""),
            "final_url": result.get("url", url),
        }
    except Exception as e:
        return {
            "origin": origin,
            "url": url,
            "ok": False,
            "error": f"render_failed: {str(e)[:200]}",
        }
