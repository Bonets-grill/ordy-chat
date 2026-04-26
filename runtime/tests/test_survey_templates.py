# tests/test_survey_templates.py — cubre runtime/app/survey_templates.py.
# Verifica que las plantillas existen para los 6 idiomas soportados y que
# el fallback a español funciona si el idioma es desconocido.

from __future__ import annotations

import pytest

from app.survey_templates import (
    build_survey_message,
    thanks_for_comment,
    thanks_for_rating,
)


@pytest.mark.parametrize("lang", ["es", "en", "de", "fr", "it", "pt"])
def test_build_survey_message_inyecta_tenant_y_nombre(lang: str) -> None:
    msg = build_survey_message(lang, "Bonets Grill", "Mario")
    assert "Bonets Grill" in msg
    assert "Mario" in msg
    # Cualquier número 1-5 debería aparecer porque la plantilla lo menciona.
    assert "1" in msg and "5" in msg


def test_build_survey_message_sin_nombre_no_pone_undefined() -> None:
    msg = build_survey_message("es", "Bonets Grill", None)
    assert "None" not in msg
    assert "undefined" not in msg
    assert msg.startswith("Hola")  # saludo en español sin nombre


def test_build_survey_message_idioma_desconocido_cae_a_es() -> None:
    msg = build_survey_message("xx", "Bonets Grill", "Mario")
    assert "Hola Mario" in msg


def test_build_survey_message_lang_none_cae_a_es() -> None:
    msg = build_survey_message(None, "Bonets Grill", "Mario")
    assert "Hola Mario" in msg


@pytest.mark.parametrize("lang,marker", [
    ("es", "Gracias"),
    ("en", "Thanks"),
    ("de", "Danke"),
    ("fr", "Merci"),
    ("it", "Grazie"),
    ("pt", "Obrigado"),
])
def test_thanks_for_rating_en_cada_idioma(lang: str, marker: str) -> None:
    assert marker in thanks_for_rating(lang)


@pytest.mark.parametrize("lang,marker", [
    ("es", "Gracias"),
    ("en", "Thanks"),
    ("de", "Danke"),
    ("fr", "Merci"),
    ("it", "Grazie"),
    ("pt", "Obrigado"),
])
def test_thanks_for_comment_en_cada_idioma(lang: str, marker: str) -> None:
    assert marker in thanks_for_comment(lang)


def test_thanks_idioma_invalido_cae_a_es() -> None:
    assert "Gracias" in thanks_for_rating("xx")
    assert "Gracias" in thanks_for_comment(None)


def test_acepta_codigo_con_region() -> None:
    # client_lang puede llegar como "es-ES", "en-US", etc.
    msg = build_survey_message("en-US", "Bonets Grill", "Mario")
    assert "Hi Mario" in msg
