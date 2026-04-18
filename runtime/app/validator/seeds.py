# runtime/app/validator/seeds.py — Fixtures de semillas + detección de nicho.

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

Nicho = Literal["universal_only", "restaurante", "clinica", "hotel", "servicios"]

ExpectedAction = Literal[
    "none",
    "crear_pedido",
    "agendar_cita",
    "mis_citas",
    "solicitar_humano",
    "recordar_cliente",
]


@dataclass(frozen=True)
class Seed:
    id: str
    text: str
    expected_action: ExpectedAction
    expected_mentions: tuple[str, ...]
    locale: str


# Orden importa: el primer match gana. Patrones más específicos primero.
_NICHO_PATTERNS: list[tuple[Nicho, re.Pattern[str]]] = [
    (
        "restaurante",
        re.compile(
            # Sufijos opcionales para plurales/derivados (pizzería, pizzas,
            # hamburguesas). Bar lleva \b por ambos lados para evitar
            # "barra", "barbero", "Barcelona".
            r"(?:restaurant\w*|\bbar\b|cafeter[ií]as?|bodegas?|men[uú]s?|"
            r"cartas?|platos?|comidas?|cocinas?|pizz\w+|sushis?|tapas\b|"
            r"hamburgues\w+|bistros?|paell\w+|postres?)",
            re.IGNORECASE,
        ),
    ),
    (
        "clinica",
        re.compile(
            r"\b(cl[ií]nica|m[eé]dico|doctor[a]?|dental|veterinaria|consulta|"
            r"odontolog[ií]a|fisioterapia|nutrici[oó]n|cita\s+m[eé]dica|"
            r"dentista|ortodoncia)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "hotel",
        re.compile(
            r"\b(hotel|hostal|alojamiento|habitaci[oó]n|hospedaje|posada|"
            r"apartamento\s+tur[ií]stico|check[- ]in)\b",
            re.IGNORECASE,
        ),
    ),
]

_SEEDS_DIR = Path(__file__).parent / "seeds"


def detectar_nicho(
    business_description: str | None,
    categories_names: list[str] | None = None,
) -> Nicho:
    """Detecta el nicho del negocio desde description + nombres de categorías.
    Primer match gana (orden de _NICHO_PATTERNS). Fallback: 'servicios'."""
    texto_busqueda = " ".join(
        filter(
            None,
            [
                business_description or "",
                " ".join(categories_names or []),
            ],
        )
    )
    if not texto_busqueda.strip():
        return "servicios"

    for nicho, pattern in _NICHO_PATTERNS:
        if pattern.search(texto_busqueda):
            return nicho
    return "servicios"


def _load_seeds_file(name: str) -> list[Seed]:
    path = _SEEDS_DIR / f"{name}.json"
    with path.open("r", encoding="utf-8") as f:
        raw = json.load(f)
    return [
        Seed(
            id=item["id"],
            text=item["text"],
            expected_action=item["expected_action"],
            expected_mentions=tuple(item["expected_mentions"]),
            locale=item["locale"],
        )
        for item in raw
    ]


def cargar_seeds(nicho: Nicho) -> list[Seed]:
    """Carga universal.json (8) + nicho.json (12) = 20 seeds.
    Si nicho == 'universal_only': devuelve solo las 8 universales."""
    universal = _load_seeds_file("universal")
    if nicho == "universal_only":
        return universal
    especificas = _load_seeds_file(nicho)
    return universal + especificas
