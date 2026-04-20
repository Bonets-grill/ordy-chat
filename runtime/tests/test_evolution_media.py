"""Regresión: Evolution adapter debe usar message.key.id como media_ref.

Bug original (pre-fix, runtime/app/providers/evolution.py):
  `media_ref = sub.get("url") or sub.get("directPath") or mid`
  Evolution emite "url" en audioMessage/imageMessage (https://mmg.whatsapp.net/...)
  → media_ref = URL → descargar_media lo mandaba como `message.key.id` al
  endpoint /chat/getBase64FromMediaMessage → endpoint no encontraba el mensaje
  → devolvía None → bot respondía "No pude descargar tu audio".

Post-fix:
  `media_ref = mid` (siempre el message.key.id, que es lo que la API pide).
"""

from __future__ import annotations

from unittest.mock import AsyncMock
from types import SimpleNamespace

import pytest

from app.providers.evolution import ProveedorEvolution


class _FakeRequest:
    """Duck-type mínimo del fastapi.Request que parsear_webhook usa."""
    headers: dict = {}
    query_params: dict = {}


def _payload_audio_con_url() -> bytes:
    """Simula el webhook Evolution para una nota de voz: URL + directPath presentes."""
    import json
    body = {
        "event": "messages.upsert",
        "data": {
            "key": {
                "id": "3A749B585F1F2CC943FB",
                "remoteJid": "34604342381@s.whatsapp.net",
                "fromMe": False,
            },
            "message": {
                "audioMessage": {
                    "url": "https://mmg.whatsapp.net/v/t62.7117-24/abcd.enc",
                    "mimetype": "audio/ogg; codecs=opus",
                    "directPath": "/v/t62.7117-24/abcd.enc",
                    "seconds": 3,
                    "ptt": True,
                },
            },
        },
    }
    return json.dumps(body).encode("utf-8")


@pytest.mark.asyncio
async def test_audiomessage_media_ref_es_key_id_no_url() -> None:
    """media_ref debe ser el message.key.id, no la URL que emite Evolution."""
    adapter = ProveedorEvolution(credentials={"instance_name": "bonets"}, webhook_secret="s")
    body = _payload_audio_con_url()
    mensajes = await adapter.parsear_webhook(_FakeRequest(), body)  # type: ignore[arg-type]

    assert len(mensajes) == 1
    msg = mensajes[0]
    assert msg.tipo_no_texto == "audio"
    assert msg.mensaje_id == "3A749B585F1F2CC943FB"
    # El bug pre-fix: media_ref era la URL. Post-fix: es el key.id.
    assert msg.media_ref == "3A749B585F1F2CC943FB", (
        f"media_ref debe ser el key.id, no la URL. Got: {msg.media_ref!r}"
    )
    assert "https://" not in (msg.media_ref or ""), (
        "media_ref nunca debe ser una URL — el endpoint Evolution lo rechaza"
    )


@pytest.mark.asyncio
async def test_descargar_media_loga_status_error(monkeypatch, caplog) -> None:
    """Cuando Evolution devuelve !=200/201, logueamos status+body para diagnóstico."""
    import logging
    monkeypatch.setenv("EVOLUTION_API_KEY", "k")
    monkeypatch.setenv("EVOLUTION_API_URL", "http://fake-evolution")

    adapter = ProveedorEvolution(credentials={"instance_name": "bonets"}, webhook_secret="s")

    fake_resp = SimpleNamespace(status_code=404, text='{"error":"message not found"}')
    fake_client = SimpleNamespace(post=AsyncMock(return_value=fake_resp))
    monkeypatch.setattr("app.providers.evolution._get_http", lambda: fake_client)

    caplog.set_level(logging.WARNING, logger="ordychat.providers.evolution")
    result = await adapter.descargar_media("FAKE_KEY_ID")

    assert result is None
    # El log debe incluir el status code y el body preview para diagnóstico futuro.
    msgs = " ".join(r.getMessage() for r in caplog.records)
    assert "404" in msgs, f"Faltó status code en log: {msgs}"
