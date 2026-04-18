# runtime/app/providers/whapi.py — Adaptador Whapi.cloud.
#
# Whapi no firma los webhooks. Usamos un shared secret en query param (?s=...)
# que se configura en la URL del webhook del tenant.

import logging
import hmac
import httpx
from fastapi import Request

from app.providers.base import MensajeEntrante, ProveedorWhatsApp

logger = logging.getLogger("ordychat.providers.whapi")

_http_client: httpx.AsyncClient | None = None


def _get_http() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None:
        _http_client = httpx.AsyncClient(timeout=20.0)
    return _http_client


class ProveedorWhapi(ProveedorWhatsApp):
    URL_ENVIO = "https://gate.whapi.cloud/messages/text"

    async def verificar_firma(self, request: Request, body_bytes: bytes) -> bool:
        if not self.webhook_secret:
            # Sin secret configurado: política strict → rechazar.
            return False
        # Preferimos header (no filtra en access logs). Fallback al query param
        # para backward compat con webhooks configurados en Whapi antes del cambio.
        provided = (
            request.headers.get("x-ordy-signature")
            or request.headers.get("x-webhook-secret")
            or request.query_params.get("s", "")
        )
        return hmac.compare_digest(provided, self.webhook_secret)

    async def parsear_webhook(self, request: Request, body_bytes: bytes) -> list[MensajeEntrante]:
        import json
        try:
            body = json.loads(body_bytes.decode("utf-8")) if body_bytes else {}
        except json.JSONDecodeError:
            return []

        mensajes: list[MensajeEntrante] = []
        for msg in body.get("messages", []):
            msg_type = msg.get("type") or "text"
            mid = msg.get("id", "")
            telefono = msg.get("chat_id", "")
            propio = bool(msg.get("from_me", False))

            if msg_type == "text":
                texto = (msg.get("text") or {}).get("body", "")
                mensajes.append(MensajeEntrante(
                    telefono=telefono, texto=texto, mensaje_id=mid, es_propio=propio,
                ))
            elif msg_type in ("image", "audio", "voice", "video", "document", "sticker"):
                media_obj = msg.get(msg_type) or {}
                media_ref = media_obj.get("link") or media_obj.get("id") or ""
                caption = media_obj.get("caption") or None
                mensajes.append(MensajeEntrante(
                    telefono=telefono, texto="", mensaje_id=mid, es_propio=propio,
                    tipo_no_texto=msg_type,
                    media_ref=media_ref or None,
                    caption=caption,
                ))
        return mensajes

    async def descargar_media(self, media_ref: str) -> tuple[bytes, str] | None:
        """Whapi: media_ref suele ser URL directa. Si es ID, usar /messages/media/{id}."""
        if not media_ref:
            return None
        token = self.credentials.get("token", "")
        client = _get_http()
        try:
            if media_ref.startswith("http"):
                r = await client.get(media_ref, headers={"Authorization": f"Bearer {token}"})
            else:
                r = await client.get(
                    f"https://gate.whapi.cloud/messages/media/{media_ref}",
                    headers={"Authorization": f"Bearer {token}"},
                )
            if r.status_code != 200:
                return None
            ctype = r.headers.get("content-type", "application/octet-stream").split(";")[0].strip()
            return r.content, ctype
        except Exception:
            return None

    async def enviar_mensaje(self, telefono: str, mensaje: str) -> bool:
        token = self.credentials.get("token", "")
        if not token:
            logger.warning("whapi token ausente — mensaje descartado")
            return False
        client = _get_http()
        r = await client.post(
            self.URL_ENVIO,
            json={"to": telefono, "body": mensaje},
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
        )
        if r.status_code != 200:
            logger.error(
                "whapi error envío",
                extra={"event": "send_error", "provider": "whapi"},
            )
        return r.status_code == 200
