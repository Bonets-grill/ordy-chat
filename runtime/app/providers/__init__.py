# runtime/app/providers/__init__.py — Factory de proveedores.

from app.providers.base import MensajeEntrante, ProveedorWhatsApp


def obtener_proveedor(nombre: str, credentials: dict, webhook_secret: str = "") -> ProveedorWhatsApp:
    nombre = (nombre or "").lower()

    if nombre == "whapi":
        from app.providers.whapi import ProveedorWhapi
        return ProveedorWhapi(credentials, webhook_secret)
    if nombre == "meta":
        from app.providers.meta import ProveedorMeta
        return ProveedorMeta(credentials, webhook_secret)
    if nombre == "twilio":
        from app.providers.twilio import ProveedorTwilio
        return ProveedorTwilio(credentials, webhook_secret)
    if nombre == "evolution":
        from app.providers.evolution import ProveedorEvolution
        return ProveedorEvolution(credentials, webhook_secret)
    raise ValueError(f"Proveedor no soportado: {nombre}")


__all__ = ["MensajeEntrante", "ProveedorWhatsApp", "obtener_proveedor"]
