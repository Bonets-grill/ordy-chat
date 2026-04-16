# runtime/app/providers/twilio.py — Adaptador Twilio WhatsApp.
#
# Verificación de firma: X-Twilio-Signature = base64(HMAC_SHA1(auth_token, URL + sorted_params))

import base64
import hashlib
import hmac
import logging
import httpx
from fastapi import Request

from app.providers.base import MensajeEntrante, ProveedorWhatsApp

logger = logging.getLogger("ordychat.providers.twilio")

_http_client: httpx.AsyncClient | None = None


def _get_http() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None:
        _http_client = httpx.AsyncClient(timeout=20.0)
    return _http_client


def _full_url(request: Request) -> str:
    # Twilio firma usando la URL completa a la que envió el webhook.
    # Detrás de proxies (Railway/Vercel), respetamos X-Forwarded-Proto.
    scheme = request.headers.get("x-forwarded-proto", request.url.scheme)
    host = request.headers.get("x-forwarded-host", request.url.netloc)
    return f"{scheme}://{host}{request.url.path}"


class ProveedorTwilio(ProveedorWhatsApp):

    async def verificar_firma(self, request: Request, body_bytes: bytes) -> bool:
        auth_token = self.credentials.get("auth_token", "")
        if not auth_token:
            return False
        signature = request.headers.get("x-twilio-signature", "")
        if not signature:
            return False

        # Reconstruimos el string que firma Twilio: URL + concat(sorted(key+value) sobre los params del form).
        from urllib.parse import parse_qsl
        form_pairs = parse_qsl(body_bytes.decode("utf-8"), keep_blank_values=True)
        form_pairs.sort(key=lambda kv: kv[0])
        payload = _full_url(request) + "".join(k + v for k, v in form_pairs)
        expected = base64.b64encode(
            hmac.new(auth_token.encode(), payload.encode(), hashlib.sha1).digest()
        ).decode()
        return hmac.compare_digest(signature, expected)

    async def parsear_webhook(self, request: Request, body_bytes: bytes) -> list[MensajeEntrante]:
        from urllib.parse import parse_qsl
        pairs = dict(parse_qsl(body_bytes.decode("utf-8"), keep_blank_values=True))
        texto = pairs.get("Body", "")
        telefono = pairs.get("From", "").replace("whatsapp:", "")
        mid = pairs.get("MessageSid", "")
        media = int(pairs.get("NumMedia", "0") or "0")
        if not texto and media > 0:
            return [MensajeEntrante(
                telefono=telefono, texto="", mensaje_id=mid, es_propio=False,
                tipo_no_texto=pairs.get("MediaContentType0", "media"),
            )]
        if not texto:
            return []
        return [MensajeEntrante(
            telefono=telefono, texto=texto, mensaje_id=mid, es_propio=False,
        )]

    async def enviar_mensaje(self, telefono: str, mensaje: str) -> bool:
        sid = self.credentials.get("account_sid", "")
        token = self.credentials.get("auth_token", "")
        from_number = self.credentials.get("phone_number", "")
        if not all([sid, token, from_number]):
            logger.warning("twilio: credenciales incompletas")
            return False

        url = f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json"
        auth = base64.b64encode(f"{sid}:{token}".encode()).decode()
        client = _get_http()
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
            logger.error(
                "twilio error envío",
                extra={"event": "send_error", "provider": "twilio"},
            )
        return r.status_code == 201
