"""Tests de admin_resolver.

Funciones puras (hash_pin, es_pin_candidato) se testean directo.
Para resolver_admin / verificar_pin usamos un FakeConn que emula la API
mínima de asyncpg.Connection (fetchrow + execute). Evita levantar Neon.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID, uuid4

import pytest

from app.admin_resolver import (
    MAX_INTENTOS,
    SESION_DIAS,
    AdminStatus,
    es_pin_candidato,
    hash_pin,
    resolver_admin,
    verificar_pin,
)


# ─────────────────────────── helpers ─────────────────────────────────


class FakeConn:
    """Emula lo mínimo de asyncpg.Connection que usa admin_resolver."""

    def __init__(self, row_factory=None):
        self._row = row_factory or (lambda *a: None)
        self.executed: list[tuple[str, tuple[Any, ...]]] = []

    async def fetchrow(self, _sql: str, *args: Any):
        return self._row(*args)

    async def execute(self, sql: str, *args: Any) -> None:
        self.executed.append((sql, args))


def _row(
    *,
    admin_id: UUID | None = None,
    display_name: str | None = "Jefe 1",
    last_auth_at=None,
    auth_attempts: int = 0,
    pin_hash: str | None = None,
) -> dict[str, Any]:
    return {
        "id": admin_id or uuid4(),
        "display_name": display_name,
        "last_auth_at": last_auth_at,
        "auth_attempts": auth_attempts,
        "pin_hash": pin_hash,
    }


# ─────────────────────────── funciones puras ─────────────────────────


def test_hash_pin_es_distinto_cada_vez() -> None:
    # bcrypt usa salt aleatorio → dos hashes distintos para el mismo PIN.
    a = hash_pin("8372")
    b = hash_pin("8372")
    assert a != b
    assert a.startswith("$2b$") or a.startswith("$2a$")


def test_hash_pin_rechaza_vacio() -> None:
    with pytest.raises(ValueError):
        hash_pin("")
    with pytest.raises(ValueError):
        hash_pin("   ")


def test_es_pin_candidato() -> None:
    # Match: 4 dígitos con whitespace permitido alrededor.
    assert es_pin_candidato("8372") == "8372"
    assert es_pin_candidato("  8372  ") == "8372"
    assert es_pin_candidato("8372\n") == "8372"
    # No match: longitud distinta, espacios internos, texto alrededor.
    assert es_pin_candidato("837") is None
    assert es_pin_candidato("83722") is None
    assert es_pin_candidato("83 72") is None
    assert es_pin_candidato("el pin es 8372") is None
    assert es_pin_candidato("") is None
    assert es_pin_candidato(None) is None  # type: ignore[arg-type]


# ─────────────────────────── resolver_admin ──────────────────────────


@pytest.mark.asyncio
async def test_resolver_no_match_devuelve_is_admin_false() -> None:
    conn = FakeConn(row_factory=lambda *_: None)
    status = await resolver_admin(conn, uuid4(), "+34999000000")  # type: ignore[arg-type]
    assert status == AdminStatus(is_admin=False, session_ok=False)


@pytest.mark.asyncio
async def test_resolver_match_sin_last_auth_requiere_pin() -> None:
    admin_id = uuid4()
    conn = FakeConn(
        row_factory=lambda *_: _row(admin_id=admin_id, last_auth_at=None),
    )
    status = await resolver_admin(conn, uuid4(), "+34604342381")  # type: ignore[arg-type]
    assert status.is_admin is True
    assert status.session_ok is False
    assert status.admin_id == admin_id
    assert status.display_name == "Jefe 1"
    assert status.locked is False


@pytest.mark.asyncio
async def test_resolver_sesion_valida_dentro_de_ventana() -> None:
    reciente = datetime.now(timezone.utc) - timedelta(days=SESION_DIAS - 1)
    conn = FakeConn(
        row_factory=lambda *_: _row(last_auth_at=reciente, auth_attempts=0),
    )
    status = await resolver_admin(conn, uuid4(), "+34604342381")  # type: ignore[arg-type]
    assert status.is_admin is True
    assert status.session_ok is True


@pytest.mark.asyncio
async def test_resolver_sesion_expirada_pide_pin_de_nuevo() -> None:
    vieja = datetime.now(timezone.utc) - timedelta(days=SESION_DIAS + 1)
    conn = FakeConn(
        row_factory=lambda *_: _row(last_auth_at=vieja, auth_attempts=0),
    )
    status = await resolver_admin(conn, uuid4(), "+34604342381")  # type: ignore[arg-type]
    assert status.is_admin is True
    assert status.session_ok is False


@pytest.mark.asyncio
async def test_resolver_locked_flag_por_intentos() -> None:
    conn = FakeConn(
        row_factory=lambda *_: _row(auth_attempts=MAX_INTENTOS),
    )
    status = await resolver_admin(conn, uuid4(), "+34604342381")  # type: ignore[arg-type]
    assert status.locked is True


# ─────────────────────────── verificar_pin ───────────────────────────


@pytest.mark.asyncio
async def test_verificar_pin_ok_resetea_attempts_y_actualiza_last_auth() -> None:
    admin_id = uuid4()
    hash_bueno = hash_pin("8372")
    conn = FakeConn(
        row_factory=lambda *_: _row(pin_hash=hash_bueno, auth_attempts=2),
    )
    ok = await verificar_pin(conn, admin_id, "8372")  # type: ignore[arg-type]
    assert ok is True
    # El único UPDATE ejecutado debe ser el de reset + last_auth_at.
    assert len(conn.executed) == 1
    sql_update = conn.executed[0][0]
    assert "last_auth_at = NOW()" in sql_update
    assert "auth_attempts = 0" in sql_update


@pytest.mark.asyncio
async def test_verificar_pin_incorrecto_incrementa_attempts() -> None:
    admin_id = uuid4()
    hash_bueno = hash_pin("8372")
    conn = FakeConn(
        row_factory=lambda *_: _row(pin_hash=hash_bueno, auth_attempts=1),
    )
    ok = await verificar_pin(conn, admin_id, "9999")  # type: ignore[arg-type]
    assert ok is False
    assert len(conn.executed) == 1
    assert "auth_attempts + 1" in conn.executed[0][0]


@pytest.mark.asyncio
async def test_verificar_pin_locked_no_consulta_hash() -> None:
    admin_id = uuid4()
    hash_bueno = hash_pin("8372")
    conn = FakeConn(
        row_factory=lambda *_: _row(pin_hash=hash_bueno, auth_attempts=MAX_INTENTOS),
    )
    # Incluso con el PIN correcto, no debe autorizar si ya pasó el cap.
    ok = await verificar_pin(conn, admin_id, "8372")  # type: ignore[arg-type]
    assert ok is False
    # Y no debe incrementar NI resetear (silencio defensivo).
    assert conn.executed == []


@pytest.mark.asyncio
async def test_verificar_pin_con_whitespace_pasa() -> None:
    admin_id = uuid4()
    hash_bueno = hash_pin("8372")
    conn = FakeConn(row_factory=lambda *_: _row(pin_hash=hash_bueno))
    assert await verificar_pin(conn, admin_id, "  8372 ") is True  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_verificar_pin_admin_id_inexistente_devuelve_false() -> None:
    conn = FakeConn(row_factory=lambda *_: None)
    assert await verificar_pin(conn, uuid4(), "8372") is False  # type: ignore[arg-type]
    assert conn.executed == []  # sin side-effects en DB
