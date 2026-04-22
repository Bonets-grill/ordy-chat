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

from app.brain import _get_client, MODEL_ID
from app.tenants import obtener_anthropic_api_key

logger = logging.getLogger("ordychat.menu_scrape")

# Límite del HTML que pasamos a Claude para no inflar tokens (~30KB ≈ 8K tokens).
MAX_HTML_CHARS = 30_000

# Tag-stripping minimalista (no necesitamos BeautifulSoup para esto).
_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


def _html_to_text(html: str) -> str:
    """Strip tags + colapsa whitespace. Suficiente para que Claude vea
    el contenido sin ruido de scripts/styles/HTML."""
    # Quitar <script> y <style> con su contenido.
    html = re.sub(r"<script\b[^>]*>.*?</script>", " ", html, flags=re.DOTALL | re.IGNORECASE)
    html = re.sub(r"<style\b[^>]*>.*?</style>", " ", html, flags=re.DOTALL | re.IGNORECASE)
    text = _TAG_RE.sub(" ", html)
    text = _WS_RE.sub(" ", text).strip()
    return text


_EXTRACT_PROMPT = """Eres un extractor de cartas de restaurante. El usuario te pasa el contenido textual scrapeado de la web/menú de un negocio. Tu tarea: devolver un JSON con la lista de items de la carta.

Formato EXACTO de respuesta (solo el JSON, sin markdown ni texto adicional):

{
  "items": [
    {"name": "<nombre exacto>", "category": "<categoría>", "price_cents": <int>, "description": "<descripción opcional>"}
  ]
}

Reglas:
- price_cents en céntimos enteros (14,90€ → 1490; 2€ → 200).
- Si no hay precio claro, OMITE el item entero (no inventes precio).
- category: usa la categoría que veas en la web (Hamburguesas / Entrantes / Bebidas / etc.). Si no hay categoría, usa "Otros".
- description: máx 100 chars, en español. Opcional.
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
        model=MODEL_ID,
        max_tokens=4096,
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
        raise ValueError(f"Claude devolvió JSON inválido: {str(e)[:200]}")

    items = parsed.get("items") if isinstance(parsed, dict) else None
    if not isinstance(items, list):
        raise ValueError("respuesta sin lista 'items'")

    cleaned: list[dict[str, Any]] = []
    for it in items:
        if not isinstance(it, dict):
            continue
        name = str(it.get("name", "")).strip()
        price_cents = it.get("price_cents")
        if not name or not isinstance(price_cents, int) or price_cents < 0:
            continue
        cleaned.append({
            "name": name[:200],
            "category": (str(it.get("category", "Otros")).strip() or "Otros")[:80],
            "price_cents": int(price_cents),
            "description": (str(it.get("description", "")).strip() or None),
        })
    logger.info(
        "menu scrape extracted",
        extra={"event": "menu_scrape", "url": url[:100], "raw_items": len(items), "valid_items": len(cleaned)},
    )
    return cleaned
