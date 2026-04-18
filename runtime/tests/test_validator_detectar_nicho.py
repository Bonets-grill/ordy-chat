"""Tests de app.validator.seeds.detectar_nicho — clasificador regex."""

import pytest
from app.validator.seeds import detectar_nicho


@pytest.mark.parametrize("desc,cats,expected", [
    # Restaurante
    ("Pizzería El Napolitano", ["Pizzas", "Entrantes"], "restaurante"),
    ("Restaurante mediterráneo de autor", None, "restaurante"),
    ("Bar de tapas en el centro", [], "restaurante"),
    ("Cafetería con WiFi", [], "restaurante"),
    ("Vendemos comida a domicilio", [], "restaurante"),
    ("Hamburguesas gourmet y patatas caseras", [], "restaurante"),
    ("Sushi y poke bowls", [], "restaurante"),
    ("Mejor paella de la ciudad", [], "restaurante"),

    # Clínica
    ("Clínica dental familiar", [], "clinica"),
    ("Consulta de nutrición", [], "clinica"),
    ("Clínica veterinaria 24h", [], "clinica"),
    ("Doctor especializado en ortodoncia", [], "clinica"),
    ("Fisioterapia deportiva", [], "clinica"),

    # Hotel
    ("Hotel boutique frente al mar", [], "hotel"),
    ("Hostal Madrid centro", [], "hotel"),
    ("Apartamento turístico en Barcelona", [], "hotel"),
    ("Alojamiento rural con encanto", [], "hotel"),

    # Servicios (fallback)
    ("Empresa de reformas", [], "servicios"),
    ("Peluquería unisex", [], "servicios"),
    ("Academia de inglés", [], "servicios"),
    ("Asesoría fiscal para autónomos", [], "servicios"),

    # Edge cases
    ("", [], "servicios"),
    (None, None, "servicios"),
    ("   ", ["   "], "servicios"),
])
def test_detectar_nicho(desc: str | None, cats: list[str] | None, expected: str):
    assert detectar_nicho(desc, cats) == expected


def test_case_insensitive():
    assert detectar_nicho("RESTAURANTE asiático", None) == "restaurante"
    assert detectar_nicho("CLÍNICA dental", None) == "clinica"
    assert detectar_nicho("HOTEL boutique", None) == "hotel"


def test_categories_names_contribuyen():
    # Description neutra, pero category match
    assert detectar_nicho("Negocio familiar", ["Pizzas especiales"]) == "restaurante"
    assert detectar_nicho("Servicios profesionales", ["Consulta odontología"]) == "clinica"


def test_primer_match_gana_por_orden():
    # Si hay palabras de 2 nichos, gana restaurante (primer pattern).
    assert detectar_nicho("Restaurante dentro de un hotel", None) == "restaurante"
