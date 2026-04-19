"""
Tests de inyección <dias_cerrados> en el system_prompt del runtime.

Verifica que `_build_now_block(tenant)`:
  - NO inyecta el bloque cuando reservations_closed_for está vacío
  - NO inyecta el bloque cuando solo hay fechas pasadas
  - Inyecta el bloque con marker HOY cuando today está en el array
  - Inyecta fechas futuras ordenadas cuando no hay HOY
  - Combina HOY + futuras cuando aplica

No depende de DB. Construye TenantContext directamente.
"""

from datetime import datetime, timedelta
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest

from app.brain import _build_now_block
from app.tenants import TenantContext


def _tenant(closed_for: list[str]) -> TenantContext:
    return TenantContext(
        id=uuid4(),
        slug="bonets",
        name="Bonets Grill",
        subscription_status="active",
        paused=False,
        system_prompt="x",
        fallback_message="x",
        error_message="x",
        max_messages_per_hour=200,
        provider="evolution",
        credentials={},
        webhook_secret="s",
        schedule="Mar-Dom 13:30-16:00 y 20:00-23:30",
        timezone="Europe/Madrid",
        reservations_closed_for=closed_for,
    )


def _today_iso_madrid() -> str:
    return datetime.now(ZoneInfo("Europe/Madrid")).date().isoformat()


def _date_offset(days: int) -> str:
    return (datetime.now(ZoneInfo("Europe/Madrid")) + timedelta(days=days)).date().isoformat()


def test_sin_cerrados_no_inyecta_bloque():
    out = _build_now_block(_tenant([]))
    assert "<dias_cerrados>" not in out
    assert "</dias_cerrados>" not in out


def test_solo_fechas_pasadas_no_inyecta_bloque():
    ayer = _date_offset(-1)
    hace_semana = _date_offset(-7)
    out = _build_now_block(_tenant([ayer, hace_semana]))
    assert "<dias_cerrados>" not in out


def test_hoy_cerrado_inyecta_bloque_con_marker():
    hoy = _today_iso_madrid()
    out = _build_now_block(_tenant([hoy]))
    assert "<dias_cerrados>" in out
    assert "</dias_cerrados>" in out
    assert f"HOY ({hoy})" in out
    # Si solo hay hoy, la línea "Fechas futuras sin reservas" NO debe aparecer.
    assert "Fechas futuras sin reservas" not in out


def test_solo_futuras_sin_hoy_lista_fechas_ordenadas():
    manana = _date_offset(1)
    en_tres = _date_offset(3)
    en_diez = _date_offset(10)
    # Desordenadas a propósito.
    out = _build_now_block(_tenant([en_diez, manana, en_tres]))
    assert "<dias_cerrados>" in out
    assert "Fechas futuras sin reservas" in out
    # Aparecen ordenadas ascendentemente.
    idx_manana = out.index(manana)
    idx_tres = out.index(en_tres)
    idx_diez = out.index(en_diez)
    assert idx_manana < idx_tres < idx_diez
    # Sin hoy en el array, NO hay marker HOY.
    assert "HOY (" not in out


def test_hoy_mas_futuras_combinadas():
    hoy = _today_iso_madrid()
    manana = _date_offset(1)
    out = _build_now_block(_tenant([hoy, manana]))
    assert f"HOY ({hoy})" in out
    assert "Fechas futuras sin reservas" in out
    assert manana in out


def test_regla_de_escalado_aparece_cuando_hay_bloque():
    hoy = _today_iso_madrid()
    out = _build_now_block(_tenant([hoy]))
    # La regla le dice al modelo qué hacer: no agendar_cita + solicitar_humano.
    assert "NUNCA llames a `agendar_cita`" in out
    assert "solicitar_humano" in out


def test_pasadas_filtradas_no_contaminan_bloque():
    hoy = _today_iso_madrid()
    ayer = _date_offset(-1)
    pasado_mes = _date_offset(-30)
    manana = _date_offset(1)
    out = _build_now_block(_tenant([ayer, pasado_mes, hoy, manana]))
    # Las pasadas nunca aparecen en el texto final.
    assert ayer not in out
    assert pasado_mes not in out
    # Las ≥ hoy sí.
    assert hoy in out
    assert manana in out


@pytest.mark.parametrize("tz", ["Europe/Madrid", "Atlantic/Canary"])
def test_respeta_tz_del_tenant_para_calcular_hoy(tz: str):
    """`hoy` debe calcularse en la tz del tenant, no en UTC fijo."""
    hoy_tz = datetime.now(ZoneInfo(tz)).date().isoformat()
    t = TenantContext(
        id=uuid4(),
        slug="x",
        name="x",
        subscription_status="active",
        paused=False,
        system_prompt="x",
        fallback_message="x",
        error_message="x",
        max_messages_per_hour=200,
        provider="evolution",
        credentials={},
        webhook_secret="s",
        schedule="24/7",
        timezone=tz,
        reservations_closed_for=[hoy_tz],
    )
    out = _build_now_block(t)
    assert f"HOY ({hoy_tz})" in out
