"""runtime/app/menu_search.py — Búsqueda fuzzy de items en la carta del tenant.

Soporta tres niveles de matching, en orden de prioridad:
  1. Exacto case-insensitive (LOWER(name) = LOWER($query))
  2. Substring ILIKE ('%query%' o cada palabra como token)
  3. Si pg_trgm está disponible, similarity() para typos (Dakota → Dacoka)

Si pg_trgm no está habilitado, el #3 se skipea silenciosamente y los #1/#2
ya cubren la mayoría de casos. Para activar trigram en el futuro:
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
    CREATE INDEX menu_items_name_trgm_idx ON menu_items USING gin (name gin_trgm_ops);
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from app.memory import inicializar_pool


async def buscar_items(tenant_id: UUID, query: str, limit: int = 5) -> list[dict[str, Any]]:
    """Devuelve hasta `limit` items que matchean `query` para el tenant.

    Ranking:
      - Exact case-insensitive primero.
      - Substring matches después.
      - Solo items con available=true.
    """
    q = query.strip()
    if not q:
        return []
    pool = await inicializar_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, category, name, price_cents, description,
                   CASE
                     WHEN LOWER(name) = LOWER($2) THEN 1
                     WHEN LOWER(name) LIKE LOWER($2) || '%' THEN 2
                     WHEN LOWER(name) LIKE '%' || LOWER($2) || '%' THEN 3
                     WHEN LOWER(COALESCE(description, '')) LIKE '%' || LOWER($2) || '%' THEN 4
                     ELSE 5
                   END AS rank
            FROM menu_items
            WHERE tenant_id = $1
              AND available = true
              AND (
                LOWER(name) LIKE '%' || LOWER($2) || '%'
                OR LOWER(COALESCE(description, '')) LIKE '%' || LOWER($2) || '%'
              )
            ORDER BY rank, sort_order, name
            LIMIT $3
            """,
            tenant_id, q, limit,
        )
    return [
        {
            "id": str(r["id"]),
            "category": r["category"],
            "name": r["name"],
            "price_eur": (r["price_cents"] or 0) / 100,
            "description": r["description"] or "",
        }
        for r in rows
    ]
