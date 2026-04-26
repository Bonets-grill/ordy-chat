# runtime/app/survey_response_parser.py — captura respuestas a la encuesta
# NPS post-pedido (mig 057) sin invocar al brain.
#
# Lógica:
#   - Si el cliente tiene una survey en status='sent' enviada en últimos 7d,
#     y manda un mensaje de 1 char "1"-"5" → guardamos rating, status →
#     'answered', enviamos thanks_for_rating en su idioma. NO invocamos brain.
#   - Si ya respondió rating y manda texto >= 3 chars dentro de los siguientes
#     5 minutos → guardamos como feedback_text, enviamos thanks_for_comment.
#     NO invocamos brain.
#   - En cualquier otro caso → return False y el flow continúa al brain.
#
# Idioma: si la survey trae client_lang persistido (raro, en prod siempre
# null porque solo se setea desde el dispatcher), lo usamos. Si no, detectamos
# del último mensaje del cliente con app.lang_detect.

from __future__ import annotations

import logging
import re
from typing import Any
from uuid import UUID

from app.lang_detect import detectar_idioma_cliente
from app.memory import inicializar_pool
from app.messaging import enviar_a_cliente
from app.survey_templates import thanks_for_comment, thanks_for_rating

logger = logging.getLogger("ordychat.surveys")

_RATING_RE = re.compile(r"^\s*([1-5])\s*$")
_FEEDBACK_WINDOW_MIN = 5  # minutos tras rating para capturar comentario


async def intentar_capturar_respuesta_encuesta(
    tenant_id: UUID,
    customer_phone: str,
    texto: str,
    historial: list[dict[str, Any]],
) -> bool:
    """Intenta capturar el mensaje como respuesta a una encuesta NPS.

    Devuelve True si lo capturó (caller debe NO invocar brain).
    Devuelve False si no aplica (caller sigue al flow normal).
    """
    if not texto or not texto.strip():
        return False

    pool = await inicializar_pool()
    async with pool.acquire() as conn:
        # 1. Hay una encuesta sent reciente para este cliente?
        survey = await conn.fetchrow(
            """
            SELECT id, status, rating, sent_at, answered_at, client_lang
              FROM post_order_surveys
             WHERE tenant_id = $1 AND customer_phone = $2
               AND status IN ('sent', 'answered')
               AND sent_at > NOW() - INTERVAL '7 days'
             ORDER BY sent_at DESC
             LIMIT 1
            """,
            tenant_id, customer_phone,
        )
        if not survey:
            return False

        # Determinar idioma para el agradecimiento.
        lang = survey["client_lang"] or detectar_idioma_cliente(historial, texto)

        # 2. Match rating "1"-"5"?
        m = _RATING_RE.match(texto)
        if m and survey["status"] == "sent":
            rating = int(m.group(1))
            await conn.execute(
                """
                UPDATE post_order_surveys
                   SET rating = $1, status = 'answered', answered_at = NOW(),
                       client_lang = COALESCE(client_lang, $3)
                 WHERE id = $2
                """,
                rating, survey["id"], lang,
            )
            logger.info(
                "encuesta NPS rating capturado",
                extra={
                    "event": "survey_rating_captured",
                    "tenant_id": str(tenant_id),
                    "survey_id": str(survey["id"]),
                    "rating": rating,
                    "lang": lang or "es",
                },
            )
            try:
                await enviar_a_cliente(tenant_id, customer_phone, thanks_for_rating(lang))
            except Exception:
                logger.exception(
                    "fallo enviando thanks_for_rating",
                    extra={"event": "survey_thanks_send_fail"},
                )
            return True

        # 3. Ya hay rating + mensaje libre dentro de la ventana → comentario.
        if (
            survey["status"] == "answered"
            and survey["rating"] is not None
            and survey["answered_at"] is not None
            and len(texto.strip()) >= 3
        ):
            # Solo aceptamos comentario en los primeros _FEEDBACK_WINDOW_MIN
            # tras el rating. Si el cliente vuelve días después con un mensaje
            # nuevo, lo trata el brain como conversación normal.
            from datetime import datetime, timezone, timedelta
            now = datetime.now(timezone.utc)
            cutoff = survey["answered_at"] + timedelta(minutes=_FEEDBACK_WINDOW_MIN)
            if now <= cutoff:
                # Si ya hay feedback, NO sobreescribir — guardar el primero.
                # (El cliente puede seguir escribiendo cosas; no acumulamos
                # ruido). Si quieres acumular, cambiar a string concat.
                existing = await conn.fetchval(
                    "SELECT feedback_text FROM post_order_surveys WHERE id = $1",
                    survey["id"],
                )
                if not existing:
                    await conn.execute(
                        "UPDATE post_order_surveys SET feedback_text = $1 WHERE id = $2",
                        texto.strip()[:2000],  # truncar a 2k chars defensivo
                        survey["id"],
                    )
                    logger.info(
                        "encuesta NPS feedback_text capturado",
                        extra={
                            "event": "survey_feedback_captured",
                            "tenant_id": str(tenant_id),
                            "survey_id": str(survey["id"]),
                            "len": len(texto.strip()),
                        },
                    )
                    try:
                        await enviar_a_cliente(tenant_id, customer_phone, thanks_for_comment(lang))
                    except Exception:
                        logger.exception(
                            "fallo enviando thanks_for_comment",
                            extra={"event": "survey_thanks_send_fail"},
                        )
                    return True

        return False
