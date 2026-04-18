# runtime/app/providers/evolution.py — Adaptador Evolution API (WhatsApp self-hosted).
#
# Evolution es multi-instancia: cada tenant tiene su propia instancia en el
# mismo servidor, identificada por `instance_name` (guardado en credentials).
# La URL + apikey son globales (env EVOLUTION_API_URL / EVOLUTION_API_KEY).
#
# Evolution no firma los webhooks: validamos el origen con un shared secret
# en query param `?s=...` (mismo patrón que Whapi).

import json
import logging
import os
import hmac
import httpx
from fastapi import Request

from app.providers.base import MensajeEntrante, ProveedorWhatsApp

logger = logging.getLogger("ordychat.providers.evolution")

_http_client: httpx.AsyncClient | None = None


def _get_http() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None:
        _http_client = httpx.AsyncClient(timeout=20.0)
    return _http_client


class ProveedorEvolution(ProveedorWhatsApp):
    async def verificar_firma(self, request: Request, body_bytes: bytes) -> bool:
        if not self.webhook_secret:
            return False
        # Header es preferible (no aparece en access logs). Query param como
        # fallback legacy para instancias creadas antes del cambio.
        provided = (
            request.headers.get("x-ordy-signature")
            or request.headers.get("x-webhook-secret")
            or request.query_params.get("s", "")
        )
        return hmac.compare_digest(provided, self.webhook_secret)

    async def parsear_webhook(self, request: Request, body_bytes: bytes) -> list[MensajeEntrante]:
        try:
            body = json.loads(body_bytes.decode("utf-8")) if body_bytes else {}
        except json.JSONDecodeError:
            return []

        # Evolution manda `event` + `data`. Nos interesa messages.upsert.
        event = (body.get("event") or "").lower()
        if event not in ("messages.upsert", "messages_upsert"):
            return []

        data = body.get("data") or {}
        # Puede venir un solo mensaje o un array bajo "messages".
        items = data.get("messages") if isinstance(data.get("messages"), list) else [data]

        mensajes: list[MensajeEntrante] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            key = item.get("key") or {}
            mid = key.get("id", "")
            remote = key.get("remoteJid", "") or ""
            # Normalizamos JID (5491234567890@s.whatsapp.net) → teléfono "5491234567890"
            telefono = remote.split("@")[0] if "@" in remote else remote
            propio = bool(key.get("fromMe", False))

            msg_obj = item.get("message") or {}
            # Texto puede estar en conversation, extendedTextMessage.text, o imageMessage.caption
            texto = (
                msg_obj.get("conversation")
                or (msg_obj.get("extendedTextMessage") or {}).get("text")
                or ""
            )

            if texto:
                mensajes.append(MensajeEntrante(
                    telefono=telefono, texto=texto, mensaje_id=mid, es_propio=propio,
                ))
                continue

            # Detectar media no soportada.
            tipo = None
            for key_name, marker in (
                ("imageMessage", "image"),
                ("audioMessage", "audio"),
                ("videoMessage", "video"),
                ("documentMessage", "document"),
                ("stickerMessage", "sticker"),
            ):
                if key_name in msg_obj:
                    tipo = marker
                    break
            if tipo:
                # Extraer URL o mediaKey según tipo
                sub_key_map = {
                    "image": "imageMessage",
                    "audio": "audioMessage",
                    "video": "videoMessage",
                    "document": "documentMessage",
                    "sticker": "stickerMessage",
                }
                sub = msg_obj.get(sub_key_map[tipo], {}) if tipo in sub_key_map else {}
                media_ref = sub.get("url") or sub.get("directPath") or mid
                caption = sub.get("caption") or None
                mensajes.append(MensajeEntrante(
                    telefono=telefono, texto="", mensaje_id=mid, es_propio=propio,
                    tipo_no_texto=tipo,
                    media_ref=media_ref or None,
                    caption=caption,
                ))
        return mensajes

    async def descargar_media(self, media_ref: str) -> tuple[bytes, str] | None:
        """Evolution: endpoint /chat/getBase64FromMediaMessage/{instance} necesita el message.key.id."""
        import base64 as _b64
        instance = self.credentials.get("instance_name", "")
        api_key = os.getenv("EVOLUTION_API_KEY", "")
        base_url = os.getenv("EVOLUTION_API_URL", "").rstrip("/")
        if not (instance and api_key and base_url and media_ref):
            return None
        client = _get_http()
        try:
            r = await client.post(
                f"{base_url}/chat/getBase64FromMediaMessage/{instance}",
                json={"message": {"key": {"id": media_ref}}},
                headers={"Content-Type": "application/json", "apikey": api_key},
            )
            if r.status_code not in (200, 201):
                return None
            data = r.json()
            b64 = data.get("base64") or ""
            if not b64:
                return None
            mime = data.get("mimetype") or "application/octet-stream"
            return _b64.b64decode(b64), mime
        except Exception:
            return None

    async def enviar_mensaje(self, telefono: str, mensaje: str) -> bool:
        base_url = os.getenv("EVOLUTION_API_URL", "").rstrip("/")
        api_key = os.getenv("EVOLUTION_API_KEY", "")
        instance = self.credentials.get("instance_name", "")
        if not base_url or not api_key or not instance:
            logger.error(
                "evolution config ausente",
                extra={"event": "send_error", "provider": "evolution",
                       "has_url": bool(base_url), "has_key": bool(api_key), "has_instance": bool(instance)},
            )
            return False

        client = _get_http()
        r = await client.post(
            f"{base_url}/message/sendText/{instance}",
            json={"number": telefono, "text": mensaje},
            headers={"Content-Type": "application/json", "apikey": api_key},
        )
        if r.status_code not in (200, 201):
            logger.error(
                "evolution error envío",
                extra={"event": "send_error", "provider": "evolution",
                       "status": r.status_code, "instance": instance},
            )
        return r.status_code in (200, 201)
