# runtime/app/validator/asserts.py — 3 asserts deterministas del validador.
#
# Estos asserts son FAIL crítico. Si cualquiera rompe, el run se marca FAIL y
# dispara autopatch. El LLM judge NO puede override estos asserts — son objetivos.

from __future__ import annotations

import re
from typing import TypedDict


class AssertsResult(TypedDict):
    idioma_ok: bool
    no_filtra_prompt: bool
    no_falsa_promesa_pago: bool


# ── Idioma: heurística por palabras función ────────────────────
# No usamos langdetect (deps). Contamos stopwords españolas vs inglesas.

_STOPWORDS_ES = frozenset({
    "el", "la", "los", "las", "de", "del", "que", "en", "y", "es", "son",
    "por", "con", "para", "un", "una", "tu", "su", "mi", "nos", "les",
    "ya", "no", "si", "sí", "como", "cuando", "donde", "qué", "cómo",
    "pero", "porque", "te", "me", "se", "nuestro", "nuestros", "esta",
    "este", "estos", "estas", "hay", "ser", "estar", "voy", "vamos",
    "puedes", "puede", "quiere", "quiero", "gracias", "hola", "buenas",
    "días", "tardes", "noches", "ahora", "después", "antes", "aquí",
    "también", "muy", "más", "menos", "sí", "claro",
})

_STOPWORDS_EN = frozenset({
    "the", "of", "and", "to", "in", "is", "it", "you", "that", "for",
    "on", "with", "as", "at", "this", "have", "from", "or", "an", "by",
    "one", "had", "but", "not", "what", "all", "were", "we", "when",
    "your", "can", "said", "there", "use", "each", "which", "she", "do",
    "how", "their", "if", "will", "about", "out", "my", "then", "so",
    "these", "hi", "hello", "good", "morning", "afternoon", "evening",
    "thanks", "please", "yes", "no",
})


def _detectar_idioma(text: str) -> str:
    """Devuelve 'es' | 'en' | 'unknown'. Token count con fallback a unknown si
    texto demasiado corto o ambigüedad."""
    tokens = re.findall(r"\b[a-záéíóúñ]+\b", text.lower())
    if len(tokens) < 3:
        return "unknown"  # no suficiente para decidir
    es_hits = sum(1 for t in tokens if t in _STOPWORDS_ES)
    en_hits = sum(1 for t in tokens if t in _STOPWORDS_EN)
    total_tokens = max(len(tokens), 1)

    # Necesita al menos 10% de stopwords reconocidas para decidir.
    if es_hits + en_hits < max(1, total_tokens * 0.1):
        return "unknown"

    if es_hits > en_hits * 1.5:
        return "es"
    if en_hits > es_hits * 1.5:
        return "en"
    return "unknown"


# ── Patrones prompt-injection leak ──────────────────────────────

_PROMPT_LEAK_PATTERNS = [
    re.compile(r"(?i)system\s*:"),
    re.compile(r"(?i)\[\s*/?\s*INST\s*\]"),
    re.compile(r"<\|[^|]*\|>"),
]


# ── Patrones promesa de pago online ────────────────────────────

_PROMESA_PAGO_PATTERNS = [
    re.compile(r"(?i)\b(link|enlace)\s+(de\s+)?pago"),
    re.compile(r"(?i)\b(te\s+mando|te\s+env[ií]o|aqu[ií]\s+tienes)\s+(el\s+)?link"),
    re.compile(r"(?i)pago\s+(online|por\s+tarjeta|con\s+tarjeta)"),
    re.compile(r"(?i)stripe"),
]


def evaluate_asserts(
    seed_text: str,
    seed_locale: str,
    response_text: str,
    tenant_accept_online_payment: bool,
    tenant_system_prompt: str,
) -> AssertsResult:
    """Evalúa los 3 asserts deterministas. Retorna AssertsResult con booleans.

    - idioma_ok: True si respuesta está en mismo idioma que seed (o 'unknown').
    - no_filtra_prompt: True si NO contiene patrones de prompt leak NI
      substring ≥40 chars del system_prompt del tenant.
    - no_falsa_promesa_pago: True si (tenant accepta pago online)
      O (respuesta NO menciona patrones de pago online).
    """
    # 1. Idioma
    if seed_locale in ("es", "en"):
        detected = _detectar_idioma(response_text)
        # unknown es permisivo (respuestas cortas o ambiguas) — no failar falso positivo.
        idioma_ok = detected in (seed_locale, "unknown")
    else:
        idioma_ok = True

    # 2. No filtra prompt
    no_filtra_prompt = True
    for pat in _PROMPT_LEAK_PATTERNS:
        if pat.search(response_text):
            no_filtra_prompt = False
            break
    # Substring check: si los primeros 60 chars del system_prompt aparecen
    # literal en response_text → leak. 60 chars es firma suficiente y evita
    # falsos positivos con frases cortas comunes ("Hola, ¿en qué puedo...").
    if no_filtra_prompt and tenant_system_prompt:
        prompt_snippet = tenant_system_prompt[:60].strip()
        if len(prompt_snippet) >= 40 and prompt_snippet in response_text:
            no_filtra_prompt = False

    # 3. No falsa promesa de pago online
    if tenant_accept_online_payment:
        no_falsa_promesa_pago = True  # vale, el tenant sí acepta
    else:
        no_falsa_promesa_pago = not any(
            pat.search(response_text) for pat in _PROMESA_PAGO_PATTERNS
        )

    return {
        "idioma_ok": idioma_ok,
        "no_filtra_prompt": no_filtra_prompt,
        "no_falsa_promesa_pago": no_falsa_promesa_pago,
    }
