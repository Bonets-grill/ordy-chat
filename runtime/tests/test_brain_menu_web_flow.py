"""Tests del bloque system `_build_menu_web_flow_block` — flujo QR mesa.

Este bloque es el que le dice al bot cómo comportarse cuando el cliente
abre /m/<slug>?mesa=N desde el QR. Tres fases:

- bienvenida: primer turno, saluda + confirma mesa + ofrece bebidas.
- en_marcha: conversación ya en curso, consolida items + crea pedido.
- post_pago: mesa cerrada, no crees pedidos nuevos.

Incidente prod 2026-04-23 (conversación Bonets Grill, mesa 4):
El bot entró en fase en_marcha pero olvidaba los items pedidos entre
turnos, repetía '¿para aquí o para llevar?' dos veces seguidas y
respondía con saludo completo a 'muchas gracias'. Root cause: el
bloque en_marcha decía solo 'continúa donde lo dejasteis' — instrucción
demasiado vaga. Fix: reglas duras explícitas sobre memoria, no repetir
preguntas, no re-saludar y cuándo llamar crear_pedido.

Estos tests cementan esas reglas duras en el texto del bloque.
"""

from __future__ import annotations

from app.brain import _build_menu_web_flow_block


class TestFaseBienvenida:
    """Primer turno — cliente acaba de escanear el QR."""

    def test_sin_historial_entra_en_bienvenida(self) -> None:
        block = _build_menu_web_flow_block("5", session_status="pending", historial_len=0)
        assert "fase='bienvenida'" in block
        assert "primer turno" in block.lower()

    def test_sin_historial_y_sin_session_status_tambien_bienvenida(self) -> None:
        block = _build_menu_web_flow_block("5", session_status=None, historial_len=0)
        assert "fase='bienvenida'" in block


class TestFaseEnMarcha:
    """Conversación ya iniciada — el fix principal vive aquí."""

    def _block(self) -> str:
        return _build_menu_web_flow_block(
            "4", session_status="pending", historial_len=4
        )

    def test_no_saludar_de_nuevo(self) -> None:
        block = self._block()
        # El modelo debe leer una prohibición clara de saludar en mitad de
        # conversación. 'gracias' / 'ok' / 'perfecto' no disparan saludo.
        assert "NO saludes" in block
        assert "'gracias'" in block

    def test_no_repetir_preguntas_ya_contestadas(self) -> None:
        block = self._block()
        # Incidente Bonets: el bot preguntó 2× '¿para aquí o para llevar?'.
        assert "NO repitas una pregunta" in block
        assert "para comer aquí o para llevar" in block
        assert "en qué mesa estáis" in block

    def test_consolida_items_entre_turnos(self) -> None:
        block = self._block()
        # El bot debe ACUMULAR items del historial — no olvidarlos.
        assert "ACUMÚLALOS" in block or "acumúlalos" in block.lower()
        assert "items mencionados" in block.lower()

    def test_maneja_audio_transcrito_mal_sin_reiniciar(self) -> None:
        block = self._block()
        # Si el mensaje del cliente es raro (ej. créditos YouTube de Whisper
        # en silencio), pide repetir pero NO reinicia el flujo.
        assert "audio mal transcrito" in block.lower()
        assert "NO reinicies" in block or "no reinicies" in block.lower()

    def test_crea_pedido_con_3_datos(self) -> None:
        block = self._block()
        # order_type + mesa + ≥1 item → crear_pedido YA. Esto evita que el
        # bot se quede en loop preguntando confirmaciones redundantes.
        assert "crear_pedido" in block
        assert "order_type" in block
        assert "SIN pedir más confirmaciones" in block

    def test_no_duplica_crear_pedido(self) -> None:
        block = self._block()
        assert "NUNCA crear_pedido dos veces" in block
        assert "modificar_pedido" in block

    def test_historial_con_session_active_tambien_en_marcha(self) -> None:
        block = _build_menu_web_flow_block("3", session_status="active", historial_len=6)
        assert "fase='en_marcha'" in block

    def test_maneja_saludos_sociales_sin_romper_flujo(self) -> None:
        """Incidente Bonets 2026-04-23: cliente dijo 'un saludo' a mitad
        del pedido y el bot respondió 'No te entendí bien'. Debe
        reconocerlo y seguir."""
        block = self._block()
        assert "SALUDOS SOCIALES" in block
        assert "un saludo" in block.lower()
        assert "NUNCA respondas 'no te entendí' a un saludo" in block
        assert "SIGUE inmediatamente desde donde quedaste" in block

    def test_no_inventa_opciones_de_personalizacion(self) -> None:
        """Incidente Bonets: la Kentucky Burger (200g carne normal) no
        tiene opción smash/medallón pero el bot la inventó porque otras
        burgers del menú sí tienen smash. Regla dura: solo preguntar
        variantes que estén LITERAL en la descripción del item."""
        block = self._block()
        assert "NUNCA INVENTES OPCIONES DE PERSONALIZACIÓN" in block
        assert "LITERAL en la descripción" in block
        assert "smash vs medallón" in block
        # Excepción: toppings explícitos del cliente sí se aceptan.
        assert "sin cebolla" in block or "extra bacon" in block


class TestFasePostPago:
    def test_mesa_paid_no_crea_mas_pedidos(self) -> None:
        block = _build_menu_web_flow_block("7", session_status="paid", historial_len=12)
        assert "fase='post_pago'" in block
        assert "NO crees más pedidos" in block

    def test_mesa_closed_tambien_post_pago(self) -> None:
        block = _build_menu_web_flow_block("7", session_status="closed", historial_len=20)
        assert "fase='post_pago'" in block


class TestMesaLine:
    def test_sin_mesa_pide_al_cliente(self) -> None:
        block = _build_menu_web_flow_block("", session_status=None, historial_len=0)
        assert "NO INDICADA" in block

    def test_con_mesa_la_confirma(self) -> None:
        block = _build_menu_web_flow_block("12", session_status=None, historial_len=0)
        assert "<mesa>12</mesa>" in block


class TestBebidasCuradas:
    def test_pitch_curado_se_inyecta(self) -> None:
        block = _build_menu_web_flow_block(
            "1",
            drinks_pitch="Tenemos caña Tropical, tinto de verano y mojito.",
            session_status=None,
            historial_len=0,
        )
        assert "<bebidas_curadas>" in block
        assert "Tropical" in block
        assert "LITERALMENTE" in block

    def test_sin_pitch_pregunta_abierta(self) -> None:
        block = _build_menu_web_flow_block(
            "1", drinks_pitch="", session_status=None, historial_len=0,
        )
        assert "<bebidas_curadas>" not in block
