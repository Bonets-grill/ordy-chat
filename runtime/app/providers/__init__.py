# runtime/app/providers/__init__.py — Factory de proveedores de WhatsApp.

from app.providers.base import MensajeEntrante, ProveedorWhatsApp


def obtener_proveedor(nombre: str, credentials: dict) -> ProveedorWhatsApp:
    """Selecciona el adaptador según el proveedor configurado por el tenant."""
    nombre = (nombre or "").lower()

    if nombre == "whapi":
        from app.providers.whapi import ProveedorWhapi
        return ProveedorWhapi(credentials)
    if nombre == "meta":
        from app.providers.meta import ProveedorMeta
        return ProveedorMeta(credentials)
    if nombre == "twilio":
        from app.providers.twilio import ProveedorTwilio
        return ProveedorTwilio(credentials)
    raise ValueError(f"Proveedor no soportado: {nombre}")


__all__ = ["MensajeEntrante", "ProveedorWhatsApp", "obtener_proveedor"]
