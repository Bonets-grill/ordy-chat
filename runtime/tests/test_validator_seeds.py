"""Tests de app.validator.seeds — fixtures + cargador."""

import pytest
from app.validator.seeds import Nicho, Seed, cargar_seeds


def test_universal_tiene_8_seeds():
    seeds = cargar_seeds("universal_only")
    assert len(seeds) == 8
    assert all(isinstance(s, Seed) for s in seeds)


@pytest.mark.parametrize("nicho,expected_total", [
    ("restaurante", 20),
    ("clinica", 20),
    ("hotel", 20),
    ("servicios", 20),
])
def test_nicho_tiene_8_universales_mas_12_especificas(nicho: Nicho, expected_total: int):
    seeds = cargar_seeds(nicho)
    assert len(seeds) == expected_total, f"esperado {expected_total}, got {len(seeds)}"


def test_ids_unicos_universal():
    seeds = cargar_seeds("universal_only")
    ids = [s.id for s in seeds]
    assert len(ids) == len(set(ids)), "IDs duplicados en universal"


@pytest.mark.parametrize("nicho", ["restaurante", "clinica", "hotel", "servicios"])
def test_ids_unicos_por_nicho(nicho: Nicho):
    seeds = cargar_seeds(nicho)
    ids = [s.id for s in seeds]
    assert len(ids) == len(set(ids)), f"IDs duplicados en {nicho}"


def test_expected_action_solo_valores_permitidos():
    allowed = {"none", "crear_pedido", "agendar_cita", "mis_citas",
               "solicitar_humano", "recordar_cliente"}
    for nicho in ("universal_only", "restaurante", "clinica", "hotel", "servicios"):
        seeds = cargar_seeds(nicho)
        for s in seeds:
            assert s.expected_action in allowed, \
                f"{s.id}: expected_action inválido '{s.expected_action}'"


def test_todos_en_locale_es():
    for nicho in ("universal_only", "restaurante", "clinica", "hotel", "servicios"):
        seeds = cargar_seeds(nicho)
        for s in seeds:
            assert s.locale == "es", f"{s.id}: locale no español"


def test_text_no_vacio():
    for nicho in ("universal_only", "restaurante", "clinica", "hotel", "servicios"):
        seeds = cargar_seeds(nicho)
        for s in seeds:
            assert s.text.strip(), f"{s.id}: text vacío"


def test_expected_mentions_es_tuple():
    seeds = cargar_seeds("restaurante")
    assert all(isinstance(s.expected_mentions, tuple) for s in seeds)


def test_seed_es_frozen_dataclass():
    seeds = cargar_seeds("universal_only")
    with pytest.raises((AttributeError, TypeError, Exception)):
        seeds[0].text = "modificado"  # type: ignore[misc]


def test_orden_universales_primero_en_nicho():
    seeds = cargar_seeds("restaurante")
    # Primeras 8 son universales (uni-*)
    assert all(s.id.startswith("uni-") for s in seeds[:8])
    # Siguientes 12 son del nicho (rest-*)
    assert all(s.id.startswith("rest-") for s in seeds[8:])
