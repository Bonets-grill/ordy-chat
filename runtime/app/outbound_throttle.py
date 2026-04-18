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
import time
from collections import defaultdict

MIN_INTERVAL_SEC = 1.0  # WhatsApp banea si <1s entre mensajes al mismo número

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

    async with _lock:
        now = time.monotonic()
        last = _last_sent.get(phone, 0.0)
        delta = now - last
        wait = max(0.0, MIN_INTERVAL_SEC - delta)

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
