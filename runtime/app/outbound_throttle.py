# runtime/app/outbound_throttle.py — Anti-ban: 1 msg/seg por teléfono destino.
#
# WhatsApp (Meta + vía Baileys/Evolution) banea cuentas que envían varios
# mensajes al mismo número en <1s. Antes de cada `adapter.enviar_mensaje`,
# esperamos aquí el tiempo necesario.
#
# Implementación: diccionario {phone: last_sent_ts} protegido con asyncio.Lock.
# Es per-proceso. En producción con múltiples workers Railway no es perfecto,
# pero protege contra ráfagas del propio worker (caso más común: loop tool-use
# que dispara varias respuestas seguidas).
#
# Cuando Upstash esté disponible, migrar a `@upstash/ratelimit` equivalente
# distribuido (mismo patrón que web/lib/rate-limit.ts → limitByWhatsappSender).

import asyncio
import random
import time
from uuid import UUID

# Anti-ban: intervalo entre mensajes al mismo número con jitter humano.
# El 1s fijo original era huella detectable; ahora 0.8–2.0s aleatorio.
JITTER_MIN_SEC = 0.8
JITTER_MAX_SEC = 2.0


def _jitter_interval() -> float:
    return random.uniform(JITTER_MIN_SEC, JITTER_MAX_SEC)


_last_sent: dict[str, float] = {}
_lock = asyncio.Lock()
_max_entries = 10_000  # limpia cache cuando supera


async def esperar_turno(phone: str) -> float:
    """
    Bloquea hasta que se pueda enviar al phone. Devuelve segundos esperados.
    Uso:
        waited = await esperar_turno("+34612345678")
        await adapter.enviar_mensaje(phone, text)
    """
    if not phone:
        return 0.0

    interval = _jitter_interval()

    async with _lock:
        now = time.monotonic()
        last = _last_sent.get(phone, 0.0)
        delta = now - last
        wait = max(0.0, interval - delta)

        # Reservamos el slot AHORA (last_sent += interval) para que si otro
        # coroutine llega mientras dormimos, se ponga detrás de nosotros.
        _last_sent[phone] = now + wait

        # Limpieza periódica: si el diccionario crece mucho, purga entradas
        # con last_sent > 60s atrás (número no vuelve a escribir en 1 min).
        if len(_last_sent) > _max_entries:
            cutoff = now - 60.0
            stale = [p for p, ts in _last_sent.items() if ts < cutoff]
            for p in stale:
                _last_sent.pop(p, None)

    if wait > 0:
        await asyncio.sleep(wait)
    return wait


async def esperar_con_warmup(tenant_id: UUID, phone: str) -> dict:
    """
    Wrapper que combina cap diario de warmup + throttle por teléfono.
    Devuelve:
      - {blocked: False, waited: float, tier: str}  si paso
      - {blocked: True, reason: str, cap: int, sent_today: int, tier: str}
        si el warmup bloqueó. El caller decide qué decirle al cliente.

    Import diferido para evitar ciclos (warmup → memory → ...).
    """
    # Validator phone: skip total ANTES de chequear_warmup. El validator usa
    # brain.generar_respuesta directo sin enviar por WhatsApp, pero si en
    # algún path llega acá con este phone, no debe bloquear por cap diario
    # (fixtures controlados, no PII real).
    if phone.startswith("+00000VALIDATOR"):
        return {"blocked": False, "waited": 0.0, "tier": "mature"}

    from app.warmup import chequear_warmup
    estado = await chequear_warmup(tenant_id)
    if estado["blocked"]:
        return {
            "blocked": True,
            "reason": estado["reason"],
            "cap": estado["cap"],
            "sent_today": estado["sent_today"],
            "tier": estado["tier"],
        }

    waited = await esperar_turno(phone)
    return {"blocked": False, "waited": waited, "tier": estado["tier"]}
