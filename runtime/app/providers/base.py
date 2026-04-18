# runtime/app/providers/base.py — Interfaz común para Whapi/Meta/Twilio.

from abc import ABC, abstractmethod
from dataclasses import dataclass
from fastapi import Request


@dataclass
class MensajeEntrante:
    """Mensaje normalizado — formato único sin importar el proveedor."""
    telefono: str
    texto: str
    mensaje_id: str
    es_propio: bool
    # Tipo si no es texto: "image", "audio", "voice", "video", "document", "sticker".
    tipo_no_texto: str | None = None
    # URL directa o ID interno del provider para descargar la media. El adapter
    # concreto sabe cómo usarla (headers, endpoint, etc.).
    media_ref: str | None = None
    # Caption del adjunto (si la media lo trae).
    caption: str | None = None


class ProveedorWhatsApp(ABC):
    def __init__(self, credentials: dict, webhook_secret: str = ""):
        self.credentials = credentials or {}
        self.webhook_secret = webhook_secret or ""

    @abstractmethod
    async def parsear_webhook(self, request: Request, body_bytes: bytes) -> list[MensajeEntrante]:
        """Extrae y normaliza mensajes del payload entrante."""

    @abstractmethod
    async def enviar_mensaje(self, telefono: str, mensaje: str) -> bool:
        """Envía un mensaje de texto. Retorna True si fue exitoso."""

    @abstractmethod
    async def verificar_firma(self, request: Request, body_bytes: bytes) -> bool:
        """Valida que el webhook venga del proveedor y no de un atacante."""

    async def descargar_media(self, media_ref: str) -> tuple[bytes, str] | None:
        """
        Descarga el contenido binario de un adjunto (imagen, audio, etc).
        Devuelve (bytes, mime_type) o None si el proveedor no soporta.
        Implementación por defecto: no soportado. Cada adapter override si puede.
        """
        return None

    async def validar_webhook_get(self, request: Request) -> int | str | None:
        """GET de verificación (solo Meta lo usa). None si no aplica."""
        return None

    async def enviar_presence_typing(self, telefono: str, duracion_ms: int = 1500) -> None:
        """
        Opcional: indica "está escribiendo…" antes de enviar el mensaje real.
        Humaniza conversaciones (anti-ban Evolution/Baileys). No-op por
        defecto — cada adapter override si el proveedor lo soporta.
        """
        return None

    async def healthcheck_instancia(self) -> dict:
        """
        Opcional: estado de la instancia/conexión. Devuelve al menos
        {"state": "open"|"close"|"connecting"|"unknown"}.
        """
        return {"state": "unknown"}
