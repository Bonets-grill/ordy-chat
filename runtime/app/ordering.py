# runtime/app/ordering.py — Cliente HTTP a la web para crear pedidos y links de pago.
#
# Cuando Claude detecta intent de pedido (via tool use), el runtime llama a los
# endpoints autenticados de la web (`/api/orders` y `/api/orders/{id}/pay`) con
# el RUNTIME_INTERNAL_SECRET compartido. El link Stripe resultante vuelve a
# Claude como resultado de la tool.

import logging
import os
from typing import Any

import httpx

logger = logging.getLogger("ordychat.ordering")

_http_client: httpx.AsyncClient | None = None


def _get_http() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None:
        _http_client = httpx.AsyncClient(timeout=20.0)
    return _http_client


def _web_url() -> str:
    url = os.getenv("ORDY_WEB_URL", "").rstrip("/")
    if not url:
        raise RuntimeError("ORDY_WEB_URL no configurada en el runtime")
    return url


def _internal_secret() -> str:
    secret = os.getenv("RUNTIME_INTERNAL_SECRET", "")
    if not secret:
        raise RuntimeError("RUNTIME_INTERNAL_SECRET no configurada")
    return secret


async def crear_pedido(
    tenant_slug: str,
    items: list[dict[str, Any]],
    customer_phone: str | None = None,
    customer_name: str | None = None,
    table_number: str | None = None,
    notes: str | None = None,
    order_type: str = "takeaway",
    is_test: bool = False,
) -> dict[str, Any]:
    """
    Crea un pedido en la web. `items` debe ser una lista de dicts con:
      - name: str
      - quantity: int >= 1
      - unit_price_cents: int >= 0  (precio unitario SIN IVA)
      - vat_rate: float opcional (si no, usa default del tenant)
      - notes: str opcional

    `order_type` ('dine_in'|'takeaway') determina el flujo en cocina.
    Default 'takeaway' por backward-compat con callers legacy.

    `is_test=True` (mig 029) marca el pedido como de playground. La ruta
    /api/orders solo respeta esta flag cuando el caller se autentica con
    x-internal-secret (runtime). KDS y workers filtran is_test=false por
    defecto.

    Devuelve {orderId, totalCents, currency, isTest}.
    """
    payload: dict[str, Any] = {
        "tenantSlug": tenant_slug,
        "orderType": order_type,
        "items": [
            {
                "name": it["name"],
                "quantity": int(it["quantity"]),
                "unitPriceCents": int(it["unit_price_cents"]),
                **({"vatRate": float(it["vat_rate"])} if "vat_rate" in it else {}),
                **({"notes": it["notes"]} if it.get("notes") else {}),
            }
            for it in items
        ],
    }
    if customer_phone:
        payload["customerPhone"] = customer_phone
    if customer_name:
        payload["customerName"] = customer_name
    if table_number:
        payload["tableNumber"] = table_number
    if notes:
        payload["notes"] = notes
    if is_test:
        payload["isTest"] = True

    client = _get_http()
    r = await client.post(
        f"{_web_url()}/api/orders",
        json=payload,
        headers={"Content-Type": "application/json", "x-internal-secret": _internal_secret()},
    )
    if r.status_code != 200:
        raise RuntimeError(f"crear_pedido fallo {r.status_code}: {r.text[:300]}")
    return r.json()


async def obtener_link_pago(order_id: str) -> dict[str, Any]:
    """
    Genera/reusa el Stripe Checkout Session.
    Devuelve una de dos formas:
      - {kind: "online", url, sessionId?, reused?}   ← Stripe OK
      - {kind: "offline", reason, paymentMethods[], paymentNotes?}  ← cobrar en persona
    Nunca lanza por "Stripe no configurado" — eso es un estado operativo normal.
    """
    client = _get_http()
    r = await client.post(
        f"{_web_url()}/api/orders/{order_id}/pay",
        headers={"x-internal-secret": _internal_secret()},
    )
    if r.status_code != 200:
        raise RuntimeError(f"obtener_link_pago fallo {r.status_code}: {r.text[:300]}")
    return r.json()
