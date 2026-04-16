# runtime/app/providers/whapi.py — Adaptador para Whapi.cloud.

import logging
import httpx
from fastapi import Request

from app.providers.base import MensajeEntrante, ProveedorWhatsApp

logger = logging.getLogger("ordychat.providers.whapi")


class ProveedorWhapi(ProveedorWhatsApp):
    URL_ENVIO = "https://gate.whapi.cloud/messages/text"

    async def parsear_webhook(self, request: Request) -> list[MensajeEntrante]:
        body = await request.json()
        mensajes: list[MensajeEntrante] = []
        for msg in body.get("messages", []):
            texto = (msg.get("text") or {}).get("body", "")
            mensajes.append(MensajeEntrante(
                telefono=msg.get("chat_id", ""),
                texto=texto,
                mensaje_id=msg.get("id", ""),
                es_propio=bool(msg.get("from_me", False)),
            ))
        return mensajes

    async def enviar_mensaje(self, telefono: str, mensaje: str) -> bool:
        token = self.credentials.get("token", "")
        if not token:
            logger.warning("Whapi token ausente — mensaje descartado")
            return False
        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.post(
                self.URL_ENVIO,
                json={"to": telefono, "body": mensaje},
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
            )
            if r.status_code != 200:
                logger.error("Whapi %d: %s", r.status_code, r.text[:300])
            return r.status_code == 200
