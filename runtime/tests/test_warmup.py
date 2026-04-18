"""Tests de warmup.calcular_cap — función pura, sin DB.

La validación del flujo completo (UPDATE de burned, cuenta de mensajes_hoy)
se cubrirá con tests de integración contra Neon branch en fase 9.
"""

import pytest
from app.warmup import calcular_cap, _tier_por_dias


def test_cap_dia_0():
    assert calcular_cap(0) == 30


def test_cap_dia_1():
    assert calcular_cap(1) == 30


def test_cap_dia_3_limite_fresh():
    assert calcular_cap(3) == 30


def test_cap_dia_4_early():
    assert calcular_cap(4) == 100


def test_cap_dia_7_limite_early():
    assert calcular_cap(7) == 100


def test_cap_dia_8_mid():
    assert calcular_cap(8) == 300


def test_cap_dia_14_limite_mid():
    assert calcular_cap(14) == 300


def test_cap_dia_15_maduro_sin_cap():
    assert calcular_cap(15) is None


def test_cap_dia_100_maduro():
    assert calcular_cap(100) is None


def test_cap_dia_negativo_defensive():
    """Si created_at está en el futuro (clock skew), tratamos como fresh."""
    assert calcular_cap(-1) == 30


def test_tier_fresh():
    assert _tier_por_dias(0) == "fresh"
    assert _tier_por_dias(3) == "fresh"


def test_tier_early():
    assert _tier_por_dias(4) == "early"
    assert _tier_por_dias(7) == "early"


def test_tier_mid():
    assert _tier_por_dias(8) == "mid"
    assert _tier_por_dias(14) == "mid"


def test_tier_mature():
    assert _tier_por_dias(15) == "mature"
    assert _tier_por_dias(365) == "mature"


@pytest.mark.parametrize(
    "days,expected_cap,expected_tier",
    [
        (0, 30, "fresh"),
        (3, 30, "fresh"),
        (4, 100, "early"),
        (7, 100, "early"),
        (8, 300, "mid"),
        (14, 300, "mid"),
        (15, None, "mature"),
    ],
)
def test_matriz_completa(days: int, expected_cap: int | None, expected_tier: str):
    assert calcular_cap(days) == expected_cap
    assert _tier_por_dias(days) == expected_tier
