"""
Tests del double-guard `reservations_closed_for` en crear_cita.

Si la fecha local (TZ del tenant) de la reserva está en el array closed_for,
la tool devuelve ok=False, error='fecha_no_disponible' SIN tocar DB.

Se ejecuta antes del INSERT — los tests no necesitan pool real, verificamos
el guard puro.
"""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

from app.agent_tools import crear_cita


@pytest.mark.asyncio
async def test_rechaza_si_fecha_local_esta_en_closed_for():
    # Reserva mañana 14:00 Madrid (+02:00 verano DST ignorado para el test; usar +01 también vale).
    manana = (datetime.now(timezone.utc) + timedelta(days=2)).date().isoformat()
    iso = f"{manana}T14:00:00+02:00"
    r = await crear_cita(
        tenant_id=uuid4(),
        customer_phone="+34600000000",
        starts_at_iso=iso,
        title="Mesa para 2",
        closed_for=[manana],
        tenant_timezone="Europe/Madrid",
    )
    assert r["ok"] is False
    assert r["error"] == "fecha_no_disponible"
    assert manana in r["hint"]


@pytest.mark.asyncio
async def test_no_rechaza_si_closed_for_vacio():
    """
    closed_for=[] → el guard NO se activa. La tool avanza hasta el INSERT y
    revienta con RuntimeError('DATABASE_URL no configurada') en tests sin DB.
    Esto prueba que el guard no bloqueó la ejecución.
    """
    manana = (datetime.now(timezone.utc) + timedelta(days=2)).date().isoformat()
    iso = f"{manana}T14:00:00+02:00"
    with pytest.raises(RuntimeError, match="DATABASE_URL"):
        await crear_cita(
            tenant_id=uuid4(),
            customer_phone="+34600000000",
            starts_at_iso=iso,
            title="Mesa para 2",
            closed_for=[],
            tenant_timezone="Europe/Madrid",
        )


@pytest.mark.asyncio
async def test_no_rechaza_si_fecha_no_coincide():
    """Fecha NO está en closed_for → guard inactivo → llega al INSERT (sin DB revienta)."""
    manana = (datetime.now(timezone.utc) + timedelta(days=2)).date().isoformat()
    otro_dia = (datetime.now(timezone.utc) + timedelta(days=5)).date().isoformat()
    iso = f"{manana}T14:00:00+02:00"
    with pytest.raises(RuntimeError, match="DATABASE_URL"):
        await crear_cita(
            tenant_id=uuid4(),
            customer_phone="+34600000000",
            starts_at_iso=iso,
            title="Mesa para 2",
            closed_for=[otro_dia],
            tenant_timezone="Europe/Madrid",
        )


@pytest.mark.asyncio
async def test_compara_en_tz_del_tenant_no_en_utc():
    """
    Cliente envía 2026-06-20T22:30:00Z (UTC). En Madrid (UTC+2 verano) eso es
    2026-06-21 00:30. Si closed_for=['2026-06-21'] debe rechazar. Si en vez
    de convertir a tz del tenant usáramos starts_at.date() (UTC), quedaría
    2026-06-20 y NO rechazaría → bug. El test documenta la expectativa.
    """
    # Usar fecha en futuro razonable — 30 días adelante para no caer <90d check.
    base = datetime.now(timezone.utc) + timedelta(days=30)
    # Construir 22:30Z de ese día; local Madrid será +1 día a las 00:30.
    utc_dt = datetime(base.year, base.month, base.day, 22, 30, 0, tzinfo=timezone.utc)
    iso_utc = utc_dt.isoformat()
    # Fecha local Madrid (DST: summer → +02, winter → +01; cálculo vía zoneinfo).
    from zoneinfo import ZoneInfo
    local_day = utc_dt.astimezone(ZoneInfo("Europe/Madrid")).date().isoformat()

    r = await crear_cita(
        tenant_id=uuid4(),
        customer_phone="+34600000000",
        starts_at_iso=iso_utc,
        title="Mesa para 2",
        closed_for=[local_day],
        tenant_timezone="Europe/Madrid",
    )
    assert r["ok"] is False
    assert r["error"] == "fecha_no_disponible"


@pytest.mark.asyncio
async def test_closed_for_none_no_activa_guard():
    """closed_for=None (default) → guard inactivo → llega al INSERT."""
    manana = (datetime.now(timezone.utc) + timedelta(days=2)).date().isoformat()
    iso = f"{manana}T14:00:00+02:00"
    with pytest.raises(RuntimeError, match="DATABASE_URL"):
        await crear_cita(
            tenant_id=uuid4(),
            customer_phone="+34600000000",
            starts_at_iso=iso,
            title="Mesa para 2",
            closed_for=None,
            tenant_timezone="Europe/Madrid",
        )


@pytest.mark.asyncio
async def test_fallback_tz_madrid_si_tenant_timezone_invalido():
    """Si tenant_timezone es basura, el guard usa Madrid como fallback (no crash)."""
    manana = (datetime.now(timezone.utc) + timedelta(days=2)).date().isoformat()
    iso = f"{manana}T14:00:00+02:00"
    r = await crear_cita(
        tenant_id=uuid4(),
        customer_phone="+34600000000",
        starts_at_iso=iso,
        title="Mesa para 2",
        closed_for=[manana],
        tenant_timezone="Invalid/Notreal",
    )
    # El guard debe activarse igualmente porque Madrid es default.
    assert r["ok"] is False
    assert r["error"] == "fecha_no_disponible"
