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


class ProveedorWhatsApp(ABC):
    """Interfaz que cada proveedor debe implementar."""

    def __init__(self, credentials: dict):
        self.credentials = credentials or {}

    @abstractmethod
    async def parsear_webhook(self, request: Request) -> list[MensajeEntrante]:
        """Extrae y normaliza mensajes del payload entrante."""

    @abstractmethod
    async def enviar_mensaje(self, telefono: str, mensaje: str) -> bool:
        """Envía un mensaje de texto. Retorna True si fue exitoso."""

    async def validar_webhook(self, request: Request) -> int | str | None:
        """GET de verificación (solo Meta lo usa). None si no aplica."""
        return None
