# runtime/app/providers/twilio.py — Adaptador para Twilio WhatsApp.

import base64
import logging
import httpx
from fastapi import Request

from app.providers.base import MensajeEntrante, ProveedorWhatsApp

logger = logging.getLogger("ordychat.providers.twilio")


class ProveedorTwilio(ProveedorWhatsApp):

    async def parsear_webhook(self, request: Request) -> list[MensajeEntrante]:
        form = await request.form()
        texto = form.get("Body", "")
        if not texto:
            return []
        telefono = form.get("From", "").replace("whatsapp:", "")
        mensaje_id = form.get("MessageSid", "")
        return [MensajeEntrante(
            telefono=telefono,
            texto=texto,
            mensaje_id=mensaje_id,
            es_propio=False,
        )]

    async def enviar_mensaje(self, telefono: str, mensaje: str) -> bool:
        sid = self.credentials.get("account_sid", "")
        token = self.credentials.get("auth_token", "")
        from_number = self.credentials.get("phone_number", "")
        if not all([sid, token, from_number]):
            logger.warning("Twilio: faltan credenciales")
            return False

        url = f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json"
        auth = base64.b64encode(f"{sid}:{token}".encode()).decode()
        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.post(
                url,
                data={
                    "From": f"whatsapp:{from_number}",
                    "To": f"whatsapp:{telefono}",
                    "Body": mensaje,
                },
                headers={"Authorization": f"Basic {auth}"},
            )
            if r.status_code != 201:
                logger.error("Twilio %d: %s", r.status_code, r.text[:300])
            return r.status_code == 201
