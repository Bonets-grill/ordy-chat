"""Detector de páginas de CAPTCHA/bot-block en HTML scrapeado.

Contexto: el scraper (runtime/app/onboarding_scraper.py) recibía HTTP 200 de
URLs que en realidad devolvían un challenge page — reCAPTCHA, DataDome,
Cloudflare. Sin detectarlo, marcaba ok=True con HTML basura, los parsers del
web/ no encontraban datos y el merger devolvía canonicos={} silencioso.

Reportado 2026-04-20 con el job 8a1ca351 (Bonets Grill):
- google origin: 7K HTML con `recaptcha/enterprise/bframe`.
- tripadvisor origin: 1.6K HTML con `geo.captcha-delivery.com`.

Los patrones son ESTRUCTURALES (src de iframe, URL de script) no texto libre,
para evitar falsos positivos en webs legítimas que mencionen "captcha" en
blog posts, FAQ, o nombre de producto.
"""

from __future__ import annotations

import re
from typing import Optional

_PATRONES: list[tuple[str, re.Pattern[str]]] = [
    ("recaptcha", re.compile(r"google\.com/recaptcha/(?:api|enterprise)/", re.I)),
    ("datadome", re.compile(r"(?:ct|geo)\.captcha-delivery\.com", re.I)),
    ("cloudflare_challenge", re.compile(r"cdn-cgi/challenge-platform/", re.I)),
    ("perimeterx", re.compile(r"captcha\.px-cdn\.net|_pxcaptcha", re.I)),
    ("hcaptcha", re.compile(r"hcaptcha\.com/captcha/", re.I)),
    ("datadome_title", re.compile(r"<title[^>]*>\s*DataDome CAPTCHA\s*</title>", re.I)),
]

# Umbral mínimo: pagos de CAPTCHA típicos son >500 chars. HTMLs cortos sin
# marcador quedan fuera (p.ej. `<html></html>` vacío → no es CAPTCHA).
_MIN_LEN = 100


def detectar_captcha(html: Optional[str]) -> Optional[str]:
    """Devuelve el nombre del proveedor CAPTCHA si se detecta, o None.

    Args:
        html: contenido HTML scrapeado (tras HTTP 200).

    Returns:
        Nombre corto del proveedor ('recaptcha', 'datadome', etc.) o None
        si no hay marcador. Usar el nombre como subcódigo de error en
        onboarding_jobs.error para que el frontend muestre mensaje específico.
    """
    if not html or len(html) < _MIN_LEN:
        return None
    for nombre, patron in _PATRONES:
        if patron.search(html):
            return nombre
    return None
