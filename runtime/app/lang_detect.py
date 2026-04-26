# runtime/app/lang_detect.py — detector heurístico de idioma del cliente.
#
# Usado por el webhook WhatsApp antes de invocar brain.generar_respuesta para
# pasar `client_lang` y forzar al LLM a responder en el idioma correcto.
# Sin este módulo, el system prompt mayoritariamente español hace que clientes
# de habla alemana/inglesa/etc reciban respuestas en español inconsistentes
# (bug visto 2026-04-26 en cliente extranjero de Bonets-grill: pedido en
# alemán/inglés mezclado con KDS español).
#
# No usamos langdetect/lingua-py para evitar nueva dependencia. Heurística por
# stopwords es suficiente para mensajes WhatsApp restauración (cortos,
# vocabulario de saludo + comida + cantidades).
#
# Idiomas soportados: es, en, de, fr, it, pt. Coincide con los aceptados por
# brain.py:1383-1393 (allowlist `<client_lang>`).

from __future__ import annotations

import re

# Stopwords mínimas por idioma — palabras que aparecen en CASI cualquier mensaje
# corto del idioma. Evitamos palabras ambiguas entre idiomas (ej. "no" sirve
# en es/en/it). Solo palabras función, no contenido.

_STOPWORDS = {
    "es": frozenset({
        "el", "la", "los", "las", "del", "que", "es", "son", "por", "con",
        "para", "una", "tu", "mi", "ya", "como", "qué", "cómo", "pero",
        "porque", "te", "me", "se", "esto", "esta", "este", "hay", "voy",
        "puedes", "puede", "quiero", "gracias", "hola", "buenas", "días",
        "tardes", "noches", "también", "más", "claro", "vale", "perfecto",
        "tienen", "tiene", "tengo",
    }),
    "en": frozenset({
        "the", "and", "you", "that", "for", "with", "this", "have", "from",
        "what", "when", "your", "can", "said", "there", "would", "could",
        "their", "will", "about", "out", "then", "these", "hello", "hi",
        "thanks", "please", "good", "morning", "afternoon", "evening",
        "want", "need", "would", "like",
    }),
    "de": frozenset({
        "der", "die", "das", "den", "dem", "des", "ein", "eine", "einen",
        "und", "oder", "aber", "ist", "sind", "war", "waren", "ich", "du",
        "wir", "ihr", "sie", "mit", "von", "zu", "auf", "für", "auch",
        "nicht", "kein", "keine", "hallo", "guten", "tag", "danke", "bitte",
        "ja", "nein", "möchte", "haben", "können", "wollen",
    }),
    "fr": frozenset({
        "le", "la", "les", "un", "une", "des", "et", "ou", "mais", "est",
        "sont", "était", "étaient", "je", "tu", "il", "elle", "nous", "vous",
        "ils", "elles", "avec", "pour", "dans", "sur", "aussi", "pas",
        "bonjour", "merci", "voudrais", "peux", "pouvez", "voulez",
    }),
    "it": frozenset({
        "il", "lo", "la", "gli", "le", "un", "una", "uno", "di", "del",
        "della", "che", "sono", "era", "erano", "io", "tu", "lui", "lei",
        "noi", "voi", "loro", "con", "per", "anche", "non", "ciao",
        "buongiorno", "grazie", "vorrei", "posso", "potete",
    }),
    "pt": frozenset({
        "o", "os", "as", "do", "dos", "das", "que", "é", "são", "era",
        "eram", "eu", "tu", "ele", "ela", "nós", "vós", "eles", "elas",
        "com", "para", "também", "não", "olá", "obrigado", "obrigada",
        "queria", "posso", "podem",
    }),
}

# Min stopwords matched para considerar idioma decidido (evita falsos
# positivos en mensajes muy cortos como "1" o "ok").
_MIN_STOPWORD_HITS = 2


def detectar_idioma(textos: list[str]) -> str | None:
    """Devuelve código ISO-639-1 ('es'|'en'|'de'|'fr'|'it'|'pt') o None.

    Concatena los textos de entrada (típicamente últimos N mensajes del
    cliente) y cuenta stopwords por idioma. Devuelve el idioma con MÁS hits
    si supera el ratio mínimo. None si no hay evidencia clara — en ese caso
    el caller debe NO inyectar `<client_lang>` (deja que el LLM decida).
    """
    if not textos:
        return None
    blob = " ".join(t for t in textos if t).lower()
    tokens = re.findall(r"\b[a-zàâäéèêëîïôöûüùÿñç]+\b", blob)
    if len(tokens) < 2:
        return None
    token_set = set(tokens)

    hits = {lang: len(token_set & sw) for lang, sw in _STOPWORDS.items()}
    best_lang, best_hits = max(hits.items(), key=lambda kv: kv[1])
    if best_hits < _MIN_STOPWORD_HITS:
        return None

    # Desempate: si segundo lugar empata, no decidir.
    sorted_hits = sorted(hits.values(), reverse=True)
    if len(sorted_hits) > 1 and sorted_hits[0] == sorted_hits[1]:
        return None

    return best_lang


def detectar_idioma_cliente(historial: list[dict], texto_actual: str) -> str | None:
    """Wrapper para el webhook WhatsApp: extrae los textos de role='user'
    del historial + el mensaje actual, y delega a `detectar_idioma`.

    `historial` es la lista [{role, content}] que pasa el caller a
    brain.generar_respuesta. Sólo miramos role='user' (ignoramos asistente
    para no contar el español del bot).
    """
    user_texts: list[str] = []
    for msg in historial or []:
        if msg.get("role") == "user":
            content = msg.get("content")
            if isinstance(content, str):
                user_texts.append(content)
    if texto_actual:
        user_texts.append(texto_actual)
    # Tomamos los últimos 6 (incluyendo el actual) para que clientes que
    # cambian a respuestas cortas tipo "1" sigan teniendo contexto.
    return detectar_idioma(user_texts[-6:])
