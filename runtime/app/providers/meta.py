# runtime/app/providers/meta.py — Adaptador para Meta WhatsApp Cloud API.

import logging
import httpx
from fastapi import Request

from app.providers.base import MensajeEntrante, ProveedorWhatsApp

logger = logging.getLogger("ordychat.providers.meta")

API_VERSION = "v21.0"


class ProveedorMeta(ProveedorWhatsApp):

    async def validar_webhook(self, request: Request) -> int | None:
        params = request.query_params
        if params.get("hub.mode") != "subscribe":
            return None
        token_recibido = params.get("hub.verify_token", "")
        if token_recibido != self.credentials.get("verify_token", ""):
            return None
        try:
            return int(params.get("hub.challenge", "0"))
        except ValueError:
            return None

    async def parsear_webhook(self, request: Request) -> list[MensajeEntrante]:
        body = await request.json()
        mensajes: list[MensajeEntrante] = []
        for entry in body.get("entry", []):
            for change in entry.get("changes", []):
                value = change.get("value", {})
                for msg in value.get("messages", []):
                    if msg.get("type") != "text":
                        continue
                    mensajes.append(MensajeEntrante(
                        telefono=msg.get("from", ""),
                        texto=(msg.get("text") or {}).get("body", ""),
                        mensaje_id=msg.get("id", ""),
                        es_propio=False,
                    ))
        return mensajes

    async def enviar_mensaje(self, telefono: str, mensaje: str) -> bool:
        token = self.credentials.get("access_token", "")
        phone_id = self.credentials.get("phone_number_id", "")
        if not token or not phone_id:
            logger.warning("Meta: access_token o phone_number_id ausentes")
            return False
        url = f"https://graph.facebook.com/{API_VERSION}/{phone_id}/messages"
        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.post(
                url,
                json={
                    "messaging_product": "whatsapp",
                    "to": telefono,
                    "type": "text",
                    "text": {"body": mensaje},
                },
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
            )
            if r.status_code != 200:
                logger.error("Meta %d: %s", r.status_code, r.text[:300])
            return r.status_code == 200
