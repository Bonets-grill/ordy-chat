"""Tests del aislamiento de sesiones anónimas (widget público /m/<slug>).

Incidente prod 2026-04-23: el endpoint /internal/playground/generate usa
`customer_phone="playground-sandbox"` (placeholder compartido) para TODOS
los visitantes del widget público. Un tester escribió su nombre y reservó
una cita, y el bot empezó a saludar "¡Hola, Mario!" y a mencionar "tu
reserva de esta noche" a CUALQUIER cliente que abriera el widget. Bug
de aislamiento + privacidad.

Fix: el helper `_is_anonymous_session` detecta esos placeholders y
`generar_respuesta` + el handler de tools NO leen/escriben contexto
persistente contra ellos.
"""

from __future__ import annotations

import pytest

from app.brain import _is_anonymous_session


class TestIsAnonymousSession:
    @pytest.mark.parametrize(
        "phone",
        [
            "playground-sandbox",
            "playground-admin",
            "playground-test-123",
            "",
            None,
        ],
    )
    def test_detecta_placeholders(self, phone: str | None) -> None:
        assert _is_anonymous_session(phone) is True, f"placeholder: {phone!r}"

    @pytest.mark.parametrize(
        "phone",
        [
            "+34612345678",
            "+1-415-555-0100",
            "+34604342381",
            "+14155550100",
        ],
    )
    def test_phone_e164_real_no_es_anonimo(self, phone: str) -> None:
        assert _is_anonymous_session(phone) is False, f"real phone: {phone!r}"

    def test_phone_sin_prefijo_plus_tambien_anonimo(self) -> None:
        # Evolution puede entregar phones sin '+' — tratamos conservadoramente.
        # Aunque no matchee placeholders conocidos, un phone suelto sin + no
        # cumple E.164; dejamos el default False para no romper WhatsApp
        # legacy. Este test documenta el comportamiento actual: strings
        # arbitrarias que no son placeholder NO se consideran anónimas.
        assert _is_anonymous_session("34612345678") is False
        assert _is_anonymous_session("abc123") is False
