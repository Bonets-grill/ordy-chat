# runtime/app/providers/meta.py — Adaptador Meta WhatsApp Cloud API.
#
# Verificación de firma: X-Hub-Signature-256 = "sha256=" + HMAC_SHA256(app_secret, body)
# El tenant provee app_secret al conectar Meta.

import hashlib
import hmac
import logging
import httpx
from fastapi import Request

from app.providers.base import MensajeEntrante, ProveedorWhatsApp

logger = logging.getLogger("ordychat.providers.meta")

API_VERSION = "v21.0"

_http_client: httpx.AsyncClient | None = None


def _get_http() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None:
        _http_client = httpx.AsyncClient(timeout=20.0)
    return _http_client


class ProveedorMeta(ProveedorWhatsApp):

    async def verificar_firma(self, request: Request, body_bytes: bytes) -> bool:
        app_secret = self.credentials.get("app_secret", "")
        if not app_secret:
            logger.warning("meta: app_secret ausente — firma no verificable")
            return False
        header = request.headers.get("x-hub-signature-256", "")
        if not header.startswith("sha256="):
            return False
        provided = header[len("sha256="):]
        expected = hmac.new(app_secret.encode(), body_bytes, hashlib.sha256).hexdigest()
        return hmac.compare_digest(provided, expected)

    async def validar_webhook_get(self, request: Request) -> int | None:
        params = request.query_params
        if params.get("hub.mode") != "subscribe":
            return None
        if params.get("hub.verify_token", "") != self.credentials.get("verify_token", ""):
            return None
        try:
            return int(params.get("hub.challenge", "0"))
        except ValueError:
            return None

    async def parsear_webhook(self, request: Request, body_bytes: bytes) -> list[MensajeEntrante]:
        import json
        try:
            body = json.loads(body_bytes.decode("utf-8")) if body_bytes else {}
        except json.JSONDecodeError:
            return []

        mensajes: list[MensajeEntrante] = []
        for entry in body.get("entry", []):
            for change in entry.get("changes", []):
                value = change.get("value", {})
                for msg in value.get("messages", []):
                    t = msg.get("type", "")
                    mid = msg.get("id", "")
                    telefono = msg.get("from", "")
                    if t == "text":
                        mensajes.append(MensajeEntrante(
                            telefono=telefono,
                            texto=(msg.get("text") or {}).get("body", ""),
                            mensaje_id=mid, es_propio=False,
                        ))
                    elif t in ("image", "audio", "voice", "video", "document", "sticker"):
                        mensajes.append(MensajeEntrante(
                            telefono=telefono, texto="", mensaje_id=mid, es_propio=False,
                            tipo_no_texto=t,
                        ))
        return mensajes

    async def enviar_mensaje(self, telefono: str, mensaje: str) -> bool:
        token = self.credentials.get("access_token", "")
        phone_id = self.credentials.get("phone_number_id", "")
        if not token or not phone_id:
            logger.warning("meta: access_token o phone_number_id ausentes")
            return False
        url = f"https://graph.facebook.com/{API_VERSION}/{phone_id}/messages"
        client = _get_http()
        r = await client.post(
            url,
            json={
                "messaging_product": "whatsapp",
                "to": telefono,
                "type": "text",
                "text": {"body": mensaje},
            },
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        )
        if r.status_code != 200:
            logger.error(
                "meta error envío",
                extra={"event": "send_error", "provider": "meta"},
            )
        return r.status_code == 200
