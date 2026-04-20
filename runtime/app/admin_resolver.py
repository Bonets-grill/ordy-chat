"""Resolver de modo admin vs cliente para mensajes WhatsApp entrantes.

Contexto: el webhook resuelve tenant_id por phone_number_id del provider.
Este módulo verifica si el número remitente (from) está autorizado como
admin del tenant en la tabla tenant_admins (migración 018). Si sí, el
brain entra en modo admin (prompt + tools distintos). Si la sesión venció
o nunca se autenticó, se pide PIN antes de autorizar.

Seguridad:
  - PIN hash con bcrypt (nunca en plaintext en DB).
  - auth_attempts >= MAX_INTENTOS bloquea al admin hasta reset manual.
  - Sesión vence tras SESION_DIAS sin actividad (default 7d).
  - El PIN NO pasa por el LLM — el flujo es determinístico en este módulo.
"""

from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Awaitable, Callable, Optional
from uuid import UUID

import asyncpg
import bcrypt

logger = logging.getLogger("ordychat.admin_resolver")

SESION_DIAS = int(os.getenv("ADMIN_SESSION_DAYS", "7"))
MAX_INTENTOS = int(os.getenv("ADMIN_MAX_ATTEMPTS", "5"))
PIN_REGEX = re.compile(r"^\s*(\d{4})\s*$")


@dataclass(frozen=True)
class AdminStatus:
    """Estado del remitente frente a la tabla tenant_admins."""

    is_admin: bool
    """True si phone_wa está registrado como admin del tenant_id."""

    session_ok: bool
    """True si last_auth_at > now()-SESION_DIAS. Solo relevante si is_admin."""

    admin_id: Optional[UUID] = None
    display_name: Optional[str] = None
    auth_attempts: int = 0
    locked: bool = False
    """True si auth_attempts >= MAX_INTENTOS — el admin no puede autenticar."""


async def resolver_admin(
    conn: asyncpg.Connection,
    tenant_id: UUID,
    phone_wa: str,
) -> AdminStatus:
    """Busca phone_wa entre los admins del tenant.

    Args:
        conn: conexión asyncpg abierta (el caller la obtiene del pool).
        tenant_id: tenant ya resuelto por phone_number_id del provider.
        phone_wa: "from" del mensaje WhatsApp (formato E.164: "+34604342381").

    Returns:
        AdminStatus. Si is_admin=False → flujo cliente normal.
        Si is_admin=True y session_ok=False → pedir PIN (locked=True bloquea).
    """
    row = await conn.fetchrow(
        """
        SELECT id, display_name, last_auth_at, auth_attempts
        FROM tenant_admins
        WHERE tenant_id = $1 AND phone_wa = $2
        """,
        tenant_id, phone_wa,
    )
    if not row:
        return AdminStatus(is_admin=False, session_ok=False)

    session_ok = False
    if row["last_auth_at"]:
        cutoff = datetime.now(timezone.utc) - timedelta(days=SESION_DIAS)
        session_ok = row["last_auth_at"] > cutoff

    attempts = int(row["auth_attempts"])
    return AdminStatus(
        is_admin=True,
        session_ok=session_ok,
        admin_id=row["id"],
        display_name=row["display_name"],
        auth_attempts=attempts,
        locked=attempts >= MAX_INTENTOS,
    )


async def verificar_pin(
    conn: asyncpg.Connection,
    admin_id: UUID,
    pin_entered: str,
) -> bool:
    """Compara PIN entrado con pin_hash (bcrypt). Actualiza contadores.

    - Si correcto: resetea auth_attempts a 0, actualiza last_auth_at=NOW().
    - Si incorrecto: incrementa auth_attempts.
    - Si locked (auth_attempts >= MAX): devuelve False sin consultar hash.

    Returns:
        True sólo si el PIN hace match y el admin no está bloqueado.
    """
    row = await conn.fetchrow(
        "SELECT pin_hash, auth_attempts FROM tenant_admins WHERE id = $1",
        admin_id,
    )
    if not row:
        return False

    if int(row["auth_attempts"]) >= MAX_INTENTOS:
        logger.warning(
            "admin bloqueado por exceso de intentos",
            extra={
                "event": "admin_locked",
                "admin_id": str(admin_id),
                "attempts": row["auth_attempts"],
            },
        )
        return False

    pin_clean = pin_entered.strip().encode("utf-8")
    hash_bytes = (row["pin_hash"] or "").encode("utf-8")
    try:
        match = bcrypt.checkpw(pin_clean, hash_bytes)
    except (ValueError, TypeError):
        # Hash corrupto o formato inesperado — no autoriza pero tampoco crashea.
        match = False

    if match:
        await conn.execute(
            """UPDATE tenant_admins
               SET last_auth_at = NOW(), auth_attempts = 0
               WHERE id = $1""",
            admin_id,
        )
        logger.info(
            "admin autenticado con PIN",
            extra={"event": "admin_pin_ok", "admin_id": str(admin_id)},
        )
        return True

    await conn.execute(
        "UPDATE tenant_admins SET auth_attempts = auth_attempts + 1 WHERE id = $1",
        admin_id,
    )
    logger.warning(
        "PIN admin incorrecto",
        extra={"event": "admin_pin_fail", "admin_id": str(admin_id)},
    )
    return False


def hash_pin(pin_plain: str) -> str:
    """Genera bcrypt hash del PIN para guardar en DB.

    Llamado desde el dashboard/UI cuando admin es creado o PIN regenerado.
    Usado también por seed tests. No almacenar el plaintext NI loggearlo.
    """
    pin_clean = pin_plain.strip().encode("utf-8")
    if not pin_clean:
        raise ValueError("PIN vacío")
    return bcrypt.hashpw(pin_clean, bcrypt.gensalt()).decode("utf-8")


async def manejar_admin_flow(
    pool: "asyncpg.Pool",
    tenant_id: UUID,
    tenant_name: str,
    phone_wa: str,
    texto: str,
    enviar: "Callable[[str, str], Awaitable[None]]",
) -> bool:
    """Orquesta detección admin + PIN + respuesta. Interfaz que consume main.py.

    Flujo:
      1. Busca phone_wa en tenant_admins.
      2. Si no es admin → return False (caller sigue con flujo cliente).
      3. Si locked → mensaje de bloqueo + return True.
      4. Si sesión válida → placeholder (tools admin llegan en tanda 3).
      5. Si sesión expirada + mensaje != PIN → pide PIN.
      6. Si sesión expirada + mensaje = PIN → verifica; confirma u otro intento.

    Args:
        pool: asyncpg pool (idempotente via inicializar_pool()).
        tenant_id: tenant resuelto por provider phone_number_id.
        tenant_name: para mostrar en el mensaje de PIN.
        phone_wa: 'from' del WhatsApp (E.164).
        texto: cuerpo del mensaje entrante.
        enviar: callback async `(phone, texto) -> None` para responder. Typically
            `lambda p, t: adapter.enviar_mensaje(p, t)`.

    Returns:
        True si el flow tomó el mensaje (el caller debe hacer `return` y NO
        llamar al LLM cliente). False si phone_wa NO es admin (flujo normal).
    """
    async with pool.acquire() as conn:
        status = await resolver_admin(conn, tenant_id, phone_wa)

        if not status.is_admin:
            return False

        if status.locked:
            await enviar(
                phone_wa,
                f"Este número está bloqueado tras {MAX_INTENTOS} intentos "
                f"fallidos de PIN. El dueño puede reactivarlo desde el panel web.",
            )
            logger.warning(
                "admin locked — mensaje rechazado",
                extra={"event": "admin_locked_msg", "admin_id": str(status.admin_id)},
            )
            return True

        if status.session_ok:
            nombre = status.display_name or "admin"
            await enviar(
                phone_wa,
                f"👔 Hola {nombre}. Modo admin activo. Las herramientas para "
                f"cambiar menú, horarios y reservas llegan en la próxima "
                f"versión — mientras tanto hazlo desde el panel web.",
            )
            logger.info(
                "admin sesión válida — placeholder (tools pendientes tanda 3)",
                extra={"event": "admin_placeholder", "admin_id": str(status.admin_id)},
            )
            return True

        # Admin sin sesión válida: flujo PIN.
        pin = es_pin_candidato(texto)
        if pin is None:
            await enviar(
                phone_wa,
                f"Hola, soy el asistente de {tenant_name}. Te detecto como "
                f"admin pero tu sesión ha caducado o es tu primera vez aquí. "
                f"Mándame tu PIN de 4 dígitos para autorizarte. "
                f"Si no lo tienes, pídelo en el panel web.",
            )
            logger.info(
                "admin pin requested",
                extra={"event": "admin_pin_req", "admin_id": str(status.admin_id)},
            )
            return True

        # El texto parece un PIN → verifica.
        ok = await verificar_pin(conn, status.admin_id, pin)  # type: ignore[arg-type]
        if ok:
            nombre_sufijo = f", {status.display_name}" if status.display_name else ""
            await enviar(
                phone_wa,
                f"✓ Autorizado{nombre_sufijo}. Sesión válida {SESION_DIAS} días. "
                f"Pronto podrás pedirme cambios de menú, horarios y reservas "
                f"por aquí mismo.",
            )
            return True

        # PIN fallado → calcular restantes. verificar_pin ya incrementó.
        nuevo_attempts = status.auth_attempts + 1
        restantes = MAX_INTENTOS - nuevo_attempts
        if restantes <= 0:
            await enviar(
                phone_wa,
                f"PIN incorrecto. Has superado los {MAX_INTENTOS} intentos y "
                f"este número queda bloqueado. Desbloquea desde el panel web.",
            )
        else:
            intentos_txt = "intentos" if restantes != 1 else "intento"
            await enviar(
                phone_wa,
                f"PIN incorrecto. Te quedan {restantes} {intentos_txt}.",
            )
        return True


def es_pin_candidato(texto: str) -> Optional[str]:
    """Detecta si un texto recibido por WhatsApp parece un PIN de 4 dígitos.

    Returns:
        El PIN string si match, None si no. Trim y sin espacios internos.
        Ejemplos match: "8372", "  8372  ", "8372\n".
        No match: "83 72", "abcd", "837", "83722", "el pin es 8372".
    """
    m = PIN_REGEX.match(texto or "")
    return m.group(1) if m else None
