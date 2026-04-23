"""runtime/app/menu_scrape.py — Extracción estructurada de carta desde URL.

Fetcha el HTML del URL del tenant (web del restaurante, página del menú,
listing de Last.shop / Resy / etc.) y usa Claude para extraer items en JSON
estructurado. Devuelve lista de dicts con name/category/price_cents/description.

NO depende de servicios externos (Firecrawl, etc.) — solo httpx + anthropic SDK
que ya están en el runtime. Suficiente para MVP. Si Claude falla en extraer
de un HTML particularmente complejo (mucha JS), el caller decide qué hacer.

Uso desde el endpoint /internal/menu/scrape-url y desde el onboarding-fast
(Fase D, futura).
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

import httpx

from app.brain import _get_client
from app.tenants import obtener_anthropic_api_key

logger = logging.getLogger("ordychat.menu_scrape")

# Para la extracción de carta usamos Haiku en vez de Sonnet. Razones:
# 1. La tarea es simple (extraer JSON estructurado de HTML plano), no
#    requiere razonamiento profundo — Haiku da la misma calidad.
# 2. Haiku genera 2-3× más rápido que Sonnet. Con max_tokens=8192 y
#    una carta de 76 items, Sonnet tardaba >60s (timeout Vercel 504);
#    Haiku lo mismo en ~15-20s, dentro del budget.
# 3. Coste inferior — importante porque el scraper se llama cada vez
#    que un tenant importa o re-importa carta.
# El `brain.py` principal sigue usando Sonnet porque sí necesita
# razonamiento (decidir tools, mantener hilo, etc.).
SCRAPER_MODEL_ID = "claude-haiku-4-5-20251001"

# Límite del HTML que pasamos a Claude para no inflar tokens (~40KB ≈ 11K tokens).
# Subido de 30K a 40K porque los marcadores [IMG:...] añaden volumen por
# item (URLs de CDN largas) y no queremos recortar cartas medianas.
MAX_HTML_CHARS = 40_000

# Tag-stripping minimalista (no necesitamos BeautifulSoup para esto).
_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")
# Captura <img src="URL" ...> en cualquier orden de atributos. Grupo 1 = URL.
_IMG_RE = re.compile(
    r"""<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*>""",
    flags=re.IGNORECASE | re.DOTALL,
)


def _html_to_text(html: str) -> str:
    """Strip tags + colapsa whitespace, preservando las URLs de imagen
    como marcadores [IMG:URL] en su posición original. Así Claude puede
    asociar cada imagen con el item cercano al leer el texto.

    Sin esto, los <img src=...> se perdían al strippar tags y el
    scraper nunca devolvía image_url. Incidente 2026-04-23 Bonets:
    el importador sacaba 76 items sin imágenes aunque el HTML las tenía."""
    # Quitar <script> y <style> con su contenido.
    html = re.sub(r"<script\b[^>]*>.*?</script>", " ", html, flags=re.DOTALL | re.IGNORECASE)
    html = re.sub(r"<style\b[^>]*>.*?</style>", " ", html, flags=re.DOTALL | re.IGNORECASE)
    # Reemplaza cada <img src="URL" ...> por " [IMG:URL] " antes de borrar
    # el resto de tags. El espacio garantiza separación de palabras.
    html = _IMG_RE.sub(lambda m: f" [IMG:{m.group(1)}] ", html)
    text = _TAG_RE.sub(" ", html)
    text = _WS_RE.sub(" ", text).strip()
    return text


_EXTRACT_PROMPT = """Eres un extractor de cartas de restaurante. El usuario te pasa el contenido textual scrapeado de la web/menú de un negocio. Tu tarea: devolver un JSON con la lista de items de la carta.

Formato EXACTO de respuesta (solo el JSON, sin markdown ni texto adicional):

{
  "items": [
    {"name": "<nombre exacto>", "category": "<categoría>", "price_cents": <int>, "description": "<descripción opcional>", "image_url": "<URL absoluta opcional>"}
  ]
}

Reglas:
- price_cents en céntimos enteros (14,90€ → 1490; 2€ → 200).
- Si no hay precio claro, OMITE el item entero (no inventes precio).
- category: usa la categoría que veas en la web (Hamburguesas / Entrantes / Bebidas / etc.). Si no hay categoría, usa "Otros".
- description: máx 100 chars, en español. Opcional.
- image_url: si en el texto ves un marcador `[IMG:https://...]` cercano al item (típicamente JUSTO ANTES del nombre del item), úsalo como image_url. Debe ser URL absoluta http/https. Si no hay imagen asociada clara, omite el campo. Ignora logos del restaurante, banners de cabecera, iconos de redes sociales — solo imágenes de PLATOS/PRODUCTOS concretos. No reutilices la misma URL para varios items.
- NO inventes items. Solo extrae los que veas literal en el contenido.
- Si la web no parece tener carta, devuelve {"items": []}.
"""


async def scrape_url_to_items(
    url: str,
    anthropic_api_key: str,
) -> list[dict[str, Any]]:
    """Fetch del URL + extracción estructurada con Claude. Devuelve list de items.

    Errores:
    - HTTP no-200 o timeout → ValueError con detail.
    - Claude devuelve JSON inválido → ValueError.
    - HTML demasiado grande → trunca y sigue.
    """
    if not url.startswith(("http://", "https://")):
        raise ValueError("url debe empezar con http:// o https://")

    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as client:
        try:
            r = await client.get(url, headers={"User-Agent": "OrdyChat-Menu-Importer/1.0"})
        except httpx.HTTPError as e:
            raise ValueError(f"fetch falló: {type(e).__name__}: {str(e)[:200]}")
    if r.status_code >= 400:
        raise ValueError(f"HTTP {r.status_code} fetching {url}")

    text = _html_to_text(r.text or "")
    if len(text) > MAX_HTML_CHARS:
        text = text[:MAX_HTML_CHARS]
    if len(text) < 50:
        raise ValueError(f"contenido demasiado corto ({len(text)} chars) — ¿URL válida?")

    client = _get_client(anthropic_api_key)
    msg = await client.messages.create(
        model=SCRAPER_MODEL_ID,
        # Tuning 2026-04-23 tras tres intentos:
        # - 4096 original → cortaba strings a mitad con cartas grandes.
        # - 16384 → Claude tardaba >60s generando, y el endpoint web
        #   tiene maxDuration=60s → HTTP 504 en Vercel.
        # - 8192 (actual) → cabe la carta completa de 76 items
        #   (~6K tokens output real) y tarda ~20-30s, dentro del budget
        #   de Vercel. Sonnet 4.6 acepta 64K pero eso no significa que
        #   debamos pedirlo: el tope real es el tiempo de generación.
        max_tokens=8192,
        temperature=0,
        system=_EXTRACT_PROMPT,
        messages=[{"role": "user", "content": text}],
    )
    raw = ""
    for block in msg.content:
        if getattr(block, "type", None) == "text":
            raw += getattr(block, "text", "") or ""
    raw = raw.strip()
    # Tolerar caso donde Claude envuelve en markdown a pesar del prompt.
    if raw.startswith("```"):
        raw = re.sub(r"^```(json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as e:
        # Si hay truncamiento por max_tokens, el mensaje de error
        # típicamente es "Unterminated string" / "Expecting value".
        # Ayuda a diagnosticar el caso de carta gigante.
        stop_reason = getattr(msg, "stop_reason", None)
        raise ValueError(
            f"Claude devolvió JSON inválido: {str(e)[:200]} "
            f"(stop_reason={stop_reason}, raw_len={len(raw)})"
        )

    items = parsed.get("items") if isinstance(parsed, dict) else None
    if not isinstance(items, list):
        raise ValueError("respuesta sin lista 'items'")

    cleaned: list[dict[str, Any]] = []
    with_image = 0
    for it in items:
        if not isinstance(it, dict):
            continue
        name = str(it.get("name", "")).strip()
        price_cents = it.get("price_cents")
        if not name or not isinstance(price_cents, int) or price_cents < 0:
            continue
        image_url = _sanitizar_image_url(it.get("image_url"), url)
        if image_url:
            with_image += 1
        cleaned.append({
            "name": name[:200],
            "category": (str(it.get("category", "Otros")).strip() or "Otros")[:80],
            "price_cents": int(price_cents),
            "description": (str(it.get("description", "")).strip() or None),
            "image_url": image_url,
        })
    logger.info(
        "menu scrape extracted",
        extra={
            "event": "menu_scrape",
            "url": url[:100],
            "raw_items": len(items),
            "valid_items": len(cleaned),
            "items_with_image": with_image,
        },
    )
    return cleaned


def _sanitizar_image_url(raw: Any, base_url: str) -> str | None:
    """Valida y normaliza una URL de imagen extraída por el LLM.

    Acepta sólo http/https absolutos. Si el LLM devolvió una ruta relativa
    (típica en sitios pobres: "/uploads/x.jpg"), intenta reconstruirla con
    el base_url. Si no es parseable como URL válida, devuelve None.
    """
    if not raw or not isinstance(raw, str):
        return None
    raw = raw.strip()
    if not raw:
        return None
    if raw.startswith(("http://", "https://")):
        return raw[:500]  # cap por si el LLM alucina URLs enormes
    if raw.startswith("//"):
        # Protocol-relative. Heredamos el scheme del base_url.
        scheme = base_url.split("://", 1)[0] if "://" in base_url else "https"
        return f"{scheme}:{raw}"[:500]
    if raw.startswith("/"):
        # Relativa al host. Reconstruimos.
        try:
            from urllib.parse import urlparse

            parsed = urlparse(base_url)
            if parsed.scheme and parsed.netloc:
                return f"{parsed.scheme}://{parsed.netloc}{raw}"[:500]
        except Exception:
            return None
    return None
