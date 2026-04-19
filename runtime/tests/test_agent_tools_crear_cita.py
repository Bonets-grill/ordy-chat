"""
Regresivo P0: crear_cita rechaza fechas inválidas ANTES de tocar la DB.

Contexto: un restaurante recibió reserva para 9:00am cuando abre a las 13:30.
Parte del problema era que el tool no tenía guards de fecha básicos (pasado /
año equivocado por confabulación LLM). Este test fija ese mínimo.
"""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

from app.agent_tools import crear_cita


@pytest.mark.asyncio
async def test_rechaza_fecha_en_pasado():
    ayer = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    r = await crear_cita(
        tenant_id=uuid4(),
        customer_phone="+34600000000",
        starts_at_iso=ayer,
        title="Mesa para 2",
    )
    assert r["ok"] is False
    assert r["error"] == "fecha_en_pasado"


@pytest.mark.asyncio
async def test_rechaza_fecha_mas_de_90_dias_adelante():
    # Caso típico LLM confabulación: año +1.
    lejos = (datetime.now(timezone.utc) + timedelta(days=400)).isoformat()
    r = await crear_cita(
        tenant_id=uuid4(),
        customer_phone="+34600000000",
        starts_at_iso=lejos,
        title="Mesa para 2",
    )
    assert r["ok"] is False
    assert r["error"] == "fecha_demasiado_lejana"
    assert "año" in r["hint"].lower()  # pista al LLM de que revise el año


@pytest.mark.asyncio
async def test_rechaza_iso_invalido():
    r = await crear_cita(
        tenant_id=uuid4(),
        customer_phone="+34600000000",
        starts_at_iso="mañana a las 9",
        title="Mesa para 2",
    )
    assert r["ok"] is False
    assert "fecha_inválida" in r["error"]


@pytest.mark.asyncio
async def test_rechaza_title_vacio():
    # Válido en tiempo pero title vacío. No debe tocar DB.
    manana = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    r = await crear_cita(
        tenant_id=uuid4(),
        customer_phone="+34600000000",
        starts_at_iso=manana,
        title="",
    )
    assert r["ok"] is False
    assert r["error"] == "title requerido"
