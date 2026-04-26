# tests/test_lang_detect.py — cubre runtime/app/lang_detect.py.
# Validación crítica: el bug que golpeó a clientes alemanes 2026-04-26 sale
# si esta detección regresa.

from __future__ import annotations

import pytest

from app.lang_detect import detectar_idioma, detectar_idioma_cliente


@pytest.mark.parametrize(
    "texto,esperado",
    [
        ("Hola buenas, quiero pedir una hamburguesa con queso para llevar", "es"),
        ("Hi, I would like to order a burger with cheese please", "en"),
        ("Hallo, ich möchte einen Burger mit Käse bestellen, bitte", "de"),
        ("Bonjour, je voudrais commander un hamburger avec du fromage", "fr"),
        ("Ciao, vorrei ordinare un hamburger con formaggio per favore", "it"),
        ("Olá, queria pedir um hambúrguer com queijo, obrigado", "pt"),
    ],
)
def test_detecta_los_6_idiomas_soportados(texto: str, esperado: str) -> None:
    assert detectar_idioma([texto]) == esperado


@pytest.mark.parametrize("texto", ["1", "ok", "", "a", "  "])
def test_devuelve_none_para_textos_ambiguos_o_cortos(texto: str) -> None:
    assert detectar_idioma([texto]) is None


def test_devuelve_none_para_lista_vacia() -> None:
    assert detectar_idioma([]) is None


def test_concatena_multiples_textos() -> None:
    # Mensajes individuales débiles, pero juntos sí dan señal.
    parts = ["hola", "una de estas", "para llevar gracias"]
    assert detectar_idioma(parts) == "es"


def test_wrapper_extrae_solo_role_user() -> None:
    historial = [
        {"role": "user", "content": "Hallo"},
        {"role": "assistant", "content": "Hola, ¿qué desea?"},  # NO debe contar
        {"role": "user", "content": "einen Burger bitte"},
    ]
    # Sin contar el assistant en español, el detector debe ver alemán.
    assert detectar_idioma_cliente(historial, "mit Käse") == "de"


def test_wrapper_acepta_historial_vacio() -> None:
    assert detectar_idioma_cliente([], "Hola buenas, quiero pedir") == "es"


def test_wrapper_recorta_a_ultimos_6() -> None:
    # 8 mensajes en alemán + 1 en inglés al final → debería seguir siendo alemán
    # porque el wrapper toma los últimos 6 (los 5 alemanes + el inglés).
    hist = [{"role": "user", "content": "Hallo, ich möchte bestellen"}] * 8
    assert detectar_idioma_cliente(hist, "und ein Bier bitte") == "de"


def test_no_se_confunde_entre_es_e_it() -> None:
    # "Pizza margherita por favor" tiene "por" (es) pero también es ambiguo.
    # Verifico que un mensaje claramente italiano no se confunda con español.
    assert detectar_idioma(["Vorrei una pizza margherita per favore grazie"]) == "it"
