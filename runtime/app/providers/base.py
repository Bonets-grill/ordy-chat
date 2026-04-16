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
    # Para media no soportada (audio, imagen, video, doc).
    tipo_no_texto: str | None = None


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

    async def validar_webhook_get(self, request: Request) -> int | str | None:
        """GET de verificación (solo Meta lo usa). None si no aplica."""
        return None
