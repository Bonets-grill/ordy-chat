"""runtime/app/menu_scrape.py — Extracción estructurada de carta desde URL.

Pipeline (2026-04-23 v2, matching determinista tras incidente Bonets):

  1. Fetch HTML con httpx.
  2. Claude (Haiku) extrae items del texto plano: name + category +
     price_cents + description. NO le pedimos image_url — se corrompen
     los apóstrofos curly (''→`'`) y luego CloudFront devuelve 403
     porque el path del archivo ya no coincide.
  3. En Python, regex sobre el HTML ORIGINAL extrae todas las URLs
     `<img src="...">` INTACTAS, sin pasar por el LLM.
  4. Matching determinista: para cada item, buscar la imagen cuya URL
     contenga tokens del nombre del item (case-insensitive, tildes
     normalizadas). Fallback: proximidad DOM (la imagen que aparece
     justo antes del nombre en el HTML).
  5. `_sanitizar_image_url` aplica percent-encoding final para que el
     browser cargue la URL (emojis, apóstrofos, espacios).

Uso desde el endpoint /internal/menu/scrape-url y desde el onboarding-fast.
"""

from __future__ import annotations

import json
import logging
import re
import unicodedata
from typing import Any

import httpx

from app.brain import _get_client
from app.tenants import obtener_anthropic_api_key

logger = logging.getLogger("ordychat.menu_scrape")

# Haiku: tarea simple (extracción JSON), 2-3× más rápido que Sonnet.
SCRAPER_MODEL_ID = "claude-haiku-4-5-20251001"

# Límite del HTML que pasamos a Claude (~40KB ≈ 11K tokens).
MAX_HTML_CHARS = 40_000

_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")
# Captura <img src="URL"...>. Grupo 1 = URL intacta (puede contener emojis,
# apóstrofos curly, entidades HTML — no las tocamos hasta el post-proceso).
_IMG_RE = re.compile(
    r"""<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*>""",
    flags=re.IGNORECASE | re.DOTALL,
)


def _html_to_text(html: str) -> str:
    """Strip tags + colapsa whitespace. El LLM sólo ve texto plano.
    Las imágenes las asociamos después contra el HTML original."""
    html = re.sub(r"<script\b[^>]*>.*?</script>", " ", html, flags=re.DOTALL | re.IGNORECASE)
    html = re.sub(r"<style\b[^>]*>.*?</style>", " ", html, flags=re.DOTALL | re.IGNORECASE)
    text = _TAG_RE.sub(" ", html)
    text = _WS_RE.sub(" ", text).strip()
    return text


_EXTRACT_PROMPT = """Eres un extractor de cartas de restaurante. El usuario te pasa el contenido textual de la web/menú de un negocio. Tu tarea: devolver un JSON con la lista de items.

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
- Mantén el nombre del item TAL CUAL aparece (apóstrofos, acentos, símbolos).
- Si la web no parece tener carta, devuelve {"items": []}.
"""


def _slugify(text: str) -> str:
    """Normaliza un string para comparación fuzzy: minúsculas, sin acentos,
    sin puntuación, sin espacios. "Bonet's Crispy" → "bonetscrispy"."""
    if not text:
        return ""
    base = unicodedata.normalize("NFKD", text).lower()
    base = "".join(c for c in base if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "", base)


def _extract_image_urls_with_positions(html: str) -> list[tuple[str, int]]:
    """Extrae todas las URLs de <img src> del HTML junto con su posición
    (offset de inicio del tag). Las URLs se devuelven INTACTAS — con
    emojis, apóstrofos curly y entidades HTML tal cual — para que el
    matching posterior las reconozca contra el nombre del item."""
    result: list[tuple[str, int]] = []
    for m in _IMG_RE.finditer(html):
        url = m.group(1)
        # Saltar URLs obviamente no útiles (data URIs, tracking pixels).
        if url.startswith("data:"):
            continue
        result.append((url, m.start()))
    return result


def _match_images_to_items(
    html: str,
    items: list[dict[str, Any]],
) -> None:
    """Asocia cada item con una URL de imagen usando matching determinista.

    Estrategia en dos fases:

    1. Matching por nombre en el filename de la URL. Las imágenes del CDN
       de codemida llevan el nombre del item en el path, ej.
       ".../1744390276481-🍗 Bonet's Crispy Chicken -242.webp".
       Si `slugify(item_name) in slugify(url_filename)` → match directo.

    2. Fallback por proximidad DOM. Si la fase 1 no encontró match,
       buscamos la posición del nombre del item en el HTML y asignamos
       la `<img>` más cercana ANTES del nombre (patrón típico: imagen
       arriba, texto debajo).

    Cada URL se asigna a UN SOLO item — si una imagen ya fue matcheada,
    se excluye de las siguientes búsquedas. Esto evita que el logo del
    restaurante acabe pegado a varios items distintos.

    Mutates `items` in-place añadiendo la clave `image_url` (o None).
    """
    all_imgs = _extract_image_urls_with_positions(html)
    used: set[str] = set()

    for item in items:
        name = item.get("name") or ""
        item_slug = _slugify(name)
        matched: str | None = None

        # Fase 1: match por slug dentro del filename de la URL.
        if item_slug:
            for url, _pos in all_imgs:
                if url in used:
                    continue
                # Extraer filename (último segmento del path antes de ?).
                filename = url.rsplit("/", 1)[-1].split("?", 1)[0]
                # Strip extensión conocida.
                filename = re.sub(r"\.(webp|jpe?g|png|gif|avif)$", "", filename, flags=re.I)
                filename_slug = _slugify(filename)
                if item_slug in filename_slug:
                    matched = url
                    break

        # Fase 2: fallback por proximidad DOM. Busca el nombre literal en el
        # HTML (case-insensitive) y toma la img más cercana previa.
        if not matched and name:
            # Escapar regex-especiales del nombre para búsqueda literal.
            escaped = re.escape(name)
            name_match = re.search(escaped, html, flags=re.IGNORECASE)
            if name_match:
                name_pos = name_match.start()
                preceding = [
                    (url, pos) for (url, pos) in all_imgs
                    if pos < name_pos and url not in used
                ]
                if preceding:
                    # Más cercano = mayor offset entre los previos.
                    preceding.sort(key=lambda x: x[1], reverse=True)
                    matched = preceding[0][0]

        if matched:
            used.add(matched)
            item["_matched_image_raw"] = matched  # para sanitizar después
        else:
            item["_matched_image_raw"] = None


async def scrape_url_to_items(
    url: str,
    anthropic_api_key: str,
) -> list[dict[str, Any]]:
    """Fetch del URL + extracción estructurada + matching determinista de
    imágenes. Devuelve list de items con name/category/price_cents/
    description/image_url.

    Errores:
    - HTTP no-200 o timeout → ValueError con detail.
    - Claude devuelve JSON inválido → ValueError.
    - HTML demasiado grande → trunca el texto que va al LLM pero el
      matching de imágenes usa el HTML completo.
    """
    if not url.startswith(("http://", "https://")):
        raise ValueError("url debe empezar con http:// o https://")

    async with httpx.AsyncClient(timeout=20.0, follow_redirects=True) as http_client:
        try:
            r = await http_client.get(url, headers={"User-Agent": "OrdyChat-Menu-Importer/1.0"})
        except httpx.HTTPError as e:
            raise ValueError(f"fetch falló: {type(e).__name__}: {str(e)[:200]}")
    if r.status_code >= 400:
        raise ValueError(f"HTTP {r.status_code} fetching {url}")

    raw_html = r.text or ""
    text = _html_to_text(raw_html)
    if len(text) > MAX_HTML_CHARS:
        text = text[:MAX_HTML_CHARS]
    if len(text) < 50:
        raise ValueError(f"contenido demasiado corto ({len(text)} chars) — ¿URL válida?")

    client = _get_client(anthropic_api_key)
    msg = await client.messages.create(
        model=SCRAPER_MODEL_ID,
        # 8192 es suficiente para ~100 items sin image_url. Haiku genera
        # ~6K tokens reales en ~15s para carta de 76 items.
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
    if raw.startswith("```"):
        raw = re.sub(r"^```(json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as e:
        stop_reason = getattr(msg, "stop_reason", None)
        raise ValueError(
            f"Claude devolvió JSON inválido: {str(e)[:200]} "
            f"(stop_reason={stop_reason}, raw_len={len(raw)})"
        )

    items = parsed.get("items") if isinstance(parsed, dict) else None
    if not isinstance(items, list):
        raise ValueError("respuesta sin lista 'items'")

    # Filtrado básico antes del matching.
    valid: list[dict[str, Any]] = []
    for it in items:
        if not isinstance(it, dict):
            continue
        name = str(it.get("name", "")).strip()
        price_cents = it.get("price_cents")
        if not name or not isinstance(price_cents, int) or price_cents < 0:
            continue
        valid.append({
            "name": name[:200],
            "category": (str(it.get("category", "Otros")).strip() or "Otros")[:80],
            "price_cents": int(price_cents),
            "description": (str(it.get("description", "")).strip() or None),
        })

    # Matching determinista de imágenes contra el HTML crudo.
    _match_images_to_items(raw_html, valid)

    cleaned: list[dict[str, Any]] = []
    with_image = 0
    for it in valid:
        raw_img = it.pop("_matched_image_raw", None)
        image_url = _sanitizar_image_url(raw_img, url) if raw_img else None
        if image_url:
            with_image += 1
        cleaned.append({**it, "image_url": image_url})

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
    """Valida, normaliza y URL-encode una URL de imagen extraída del HTML.

    Acepta http/https absolutos, protocol-relative (//x), relativos al host
    (/uploads/x). Aplica percent-encoding a emojis, apóstrofos curly,
    espacios — sin modificar el contenido, sólo su representación URL.
    """
    if not raw or not isinstance(raw, str):
        return None
    raw = raw.strip()
    if not raw:
        return None

    from html import unescape

    raw = unescape(raw)

    if raw.startswith("//"):
        scheme = base_url.split("://", 1)[0] if "://" in base_url else "https"
        absolute = f"{scheme}:{raw}"
    elif raw.startswith("/"):
        try:
            from urllib.parse import urlparse

            parsed = urlparse(base_url)
            if not (parsed.scheme and parsed.netloc):
                return None
            absolute = f"{parsed.scheme}://{parsed.netloc}{raw}"
        except Exception:
            return None
    elif raw.startswith(("http://", "https://")):
        absolute = raw
    else:
        return None

    try:
        from urllib.parse import quote, urlsplit, urlunsplit

        parts = urlsplit(absolute)
        encoded_path = quote(parts.path, safe="/%")
        encoded_query = quote(parts.query, safe="=&%")
        result = urlunsplit(
            (parts.scheme, parts.netloc, encoded_path, encoded_query, "")
        )
        return result[:500]
    except Exception:
        return None
