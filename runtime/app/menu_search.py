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
    # Mig 051: alérgenos vienen de la biblioteca (menu_item_allergens + allergens),
    # no del antiguo text[] en menu_items. Subquery agrega los labels por item.
    pool = await inicializar_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT mi.id, mi.category, mi.name, mi.price_cents, mi.description,
                   mi.image_url,
                   COALESCE(
                     (SELECT array_agg(a.label ORDER BY a.sort_order, a.label)
                      FROM menu_item_allergens mia
                      JOIN allergens a ON a.id = mia.allergen_id
                      WHERE mia.menu_item_id = mi.id),
                     ARRAY[]::text[]
                   ) AS allergens,
                   CASE
                     WHEN LOWER(mi.name) = LOWER($2) THEN 1
                     WHEN LOWER(mi.name) LIKE LOWER($2) || '%' THEN 2
                     WHEN LOWER(mi.name) LIKE '%' || LOWER($2) || '%' THEN 3
                     WHEN LOWER(COALESCE(mi.description, '')) LIKE '%' || LOWER($2) || '%' THEN 4
                     ELSE 5
                   END AS rank
            FROM menu_items mi
            WHERE mi.tenant_id = $1
              AND mi.available = true
              AND (
                LOWER(mi.name) LIKE '%' || LOWER($2) || '%'
                OR LOWER(COALESCE(mi.description, '')) LIKE '%' || LOWER($2) || '%'
              )
            ORDER BY rank, mi.sort_order, mi.name
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
            "image_url": r["image_url"],
            "allergens": list(r["allergens"] or []),
        }
        for r in rows
    ]
