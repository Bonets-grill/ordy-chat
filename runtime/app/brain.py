# runtime/app/brain.py — Respuestas con Claude. Cliente singleton + prompt caching + tool use.

import json
import logging
from typing import Any

from anthropic import AsyncAnthropic, APIStatusError, APIConnectionError

from app.agent_tools import crear_cita, crear_handoff, listar_citas_del_cliente
from app.memory import actualizar_nombre_cliente, obtener_contexto_cliente
from app.ordering import crear_pedido, obtener_link_pago
from app.tenants import TenantContext, obtener_anthropic_api_key

logger = logging.getLogger("ordychat.brain")

MODEL_ID = "claude-sonnet-4-6"
MAX_TOKENS = 1024
MAX_TOOL_ITERATIONS = 4  # protege contra bucles; un pedido típico usa 1-2

# Cache de clientes por api_key. El SDK ya hace retries internos (max_retries=3).
_client_cache: dict[str, AsyncAnthropic] = {}


def _get_client(api_key: str) -> AsyncAnthropic:
    cached = _client_cache.get(api_key)
    if cached is not None:
        return cached
    client = AsyncAnthropic(api_key=api_key, max_retries=3, timeout=60.0)
    _client_cache[api_key] = client
    return client


def _render_contexto_cliente(ctx: dict[str, Any]) -> str | None:
    """Serializa el contexto persistente a texto que Claude leerá como system block."""
    if not ctx:
        return None
    lineas: list[str] = ["<cliente_conocido>"]
    nombre = ctx.get("customer_name")
    if nombre:
        lineas.append(f"Nombre: {nombre}")
        lineas.append(
            "Instrucción: saluda al cliente por su nombre de forma natural al responder, "
            "sin anunciar que lo has recordado."
        )
    pedido = ctx.get("ultimo_pedido")
    if pedido:
        items_str = ", ".join(
            f"{it['qty']}x {it['name']}" for it in pedido.get("items", [])
        )
        lineas.append(
            f"Último pedido pagado ({pedido['fecha']}): {items_str} — "
            f"total {pedido['total_eur']} {pedido.get('currency', 'EUR')}."
        )
        lineas.append(
            "Instrucción: si el cliente pide 'lo de siempre', 'lo mismo', o duda qué quiere, "
            "ofrécele repetir ese pedido literalmente (mismos productos y cantidades), "
            "y confirma antes de pasar a crear_pedido."
        )
    cita = ctx.get("proxima_cita")
    if cita:
        lineas.append(f"Próxima cita: {cita['fecha_iso']} — {cita['title']}.")
        lineas.append(
            "Instrucción: si el cliente pregunta por 'su cita' o quiere cambiarla, "
            "usa este dato antes de llamar a mis_citas."
        )
    if len(lineas) == 1:
        return None
    lineas.append("</cliente_conocido>")
    return "\n".join(lineas)


# ── Tools expuestas a Claude ───────────────────────────────────────
TOOLS: list[dict[str, Any]] = [
    {
        "name": "crear_pedido",
        "description": (
            "Crea un pedido (factura simplificada) para un comensal del restaurante y "
            "devuelve un enlace de pago de Stripe que el cliente puede abrir en su móvil. "
            "ÚSALO solo cuando el cliente ha confirmado los productos que quiere, NO para "
            "preguntas sobre la carta, sugerencias o pedidos a medias. Extrae precios del "
            "menú del restaurante que tienes en tu contexto. Si no estás seguro de un precio, "
            "pregunta al cliente antes de llamar la tool."
        ),
        "input_schema": {
            "type": "object",
            "required": ["items"],
            "properties": {
                "items": {
                    "type": "array",
                    "minItems": 1,
                    "description": "Líneas del pedido",
                    "items": {
                        "type": "object",
                        "required": ["name", "quantity", "unit_price_cents"],
                        "properties": {
                            "name": {"type": "string", "description": "Nombre del producto"},
                            "quantity": {"type": "integer", "minimum": 1},
                            "unit_price_cents": {
                                "type": "integer",
                                "minimum": 0,
                                "description": "Precio FINAL por unidad tal como aparece en el menú que ve el cliente, en céntimos (ej 14,90€ = 1490). El desglose fiscal (base + impuesto) lo calcula el sistema según el régimen del tenant — TÚ no añades ni restas impuestos, pasa el precio literal del menú.",
                            },
                            "vat_rate": {
                                "type": "number",
                                "description": "Tasa de impuesto aplicable a esta línea (ej 10 hostelería IVA peninsular, 7 IGIC Canarias, 21 alcohol). Omite para usar la tasa estándar del tenant.",
                            },
                            "notes": {"type": "string", "description": "Aclaraciones: sin sal, bien hecho, etc."},
                        },
                    },
                },
                "table_number": {"type": "string", "description": "Número de mesa si el cliente lo mencionó"},
                "customer_name": {"type": "string", "description": "Nombre del cliente si lo conoces"},
                "notes": {"type": "string", "description": "Nota general para el pedido"},
            },
        },
    },
    {
        "name": "agendar_cita",
        "description": (
            "Reserva una cita/mesa/servicio en la agenda del negocio y lo guarda en la base "
            "de datos. ÚSALO cuando el cliente confirma fecha y hora específicas. Antes de "
            "llamarla, confirma con el cliente la fecha, hora y tipo de cita para evitar "
            "errores. Si el cliente dice 'mañana a las 13h', primero calcula la fecha exacta "
            "(hoy es el día que indica la zona horaria del negocio) y confírmala."
        ),
        "input_schema": {
            "type": "object",
            "required": ["starts_at_iso", "title"],
            "properties": {
                "starts_at_iso": {
                    "type": "string",
                    "description": "Fecha y hora de inicio ISO-8601 con zona horaria (ej: 2026-04-20T13:30:00+02:00)",
                },
                "duration_min": {
                    "type": "integer",
                    "minimum": 5,
                    "maximum": 480,
                    "description": "Duración en minutos (default 30)",
                },
                "title": {
                    "type": "string",
                    "description": "Tipo de cita (ej: 'Mesa para 4', 'Limpieza dental', 'Corte de pelo')",
                },
                "customer_name": {"type": "string", "description": "Nombre del cliente si lo sabes"},
                "notes": {"type": "string", "description": "Preferencias o notas (ej: 'sin piñones', 'celíaco')"},
            },
        },
    },
    {
        "name": "mis_citas",
        "description": (
            "Consulta las próximas citas del cliente que está escribiendo ahora. Úsalo cuando "
            "el cliente pregunta 'qué cita tengo', 'a qué hora es lo mío', 'quiero cambiar mi cita'. "
            "Devuelve lista de appointments futuras con id, fecha, duración y título."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "minimum": 1, "maximum": 10, "description": "Máximo a devolver (default 5)"},
            },
        },
    },
    {
        "name": "recordar_cliente",
        "description": (
            "Guarda el nombre del cliente en la memoria persistente. ÚSALO en cuanto el "
            "cliente te diga cómo se llama ('soy Mario', 'me llamo Ana', 'Pedro al habla'). "
            "Guardarlo permite saludarle por nombre en futuras conversaciones aunque pase el "
            "tiempo y salga del historial reciente. NO inventes nombres: solo guarda lo que "
            "el cliente haya declarado explícitamente. Tras llamar esta tool, sigue la "
            "conversación con normalidad — no confirmes 'he guardado tu nombre', es ruido."
        ),
        "input_schema": {
            "type": "object",
            "required": ["nombre"],
            "properties": {
                "nombre": {
                    "type": "string",
                    "description": "Nombre (o nombre + apellido) tal como el cliente lo declaró",
                },
            },
        },
    },
    {
        "name": "solicitar_humano",
        "description": (
            "Escala la conversación a un humano del negocio. ÚSALO cuando: (a) el cliente lo "
            "pide explícitamente ('quiero hablar con una persona'), (b) el cliente está "
            "enfadado y no logras resolver, (c) hay una emergencia o pregunta que requiere "
            "a alguien con autoridad (cambios de política, reembolsos grandes), (d) no "
            "tienes información para responder con certeza. Después de llamar esta tool, "
            "dile al cliente que alguien del equipo le escribirá pronto."
        ),
        "input_schema": {
            "type": "object",
            "required": ["reason"],
            "properties": {
                "reason": {
                    "type": "string",
                    "description": "Por qué necesita un humano (ej: 'Cliente quiere reembolso de pedido #1234')",
                },
                "priority": {
                    "type": "string",
                    "enum": ["low", "normal", "urgent"],
                    "description": "urgent = emergencia/cliente muy enfadado; normal = caso estándar",
                },
                "customer_name": {"type": "string", "description": "Nombre del cliente si lo sabes"},
            },
        },
    },
]


async def _ejecutar_tool(
    tenant: TenantContext, tool_name: str, tool_input: dict[str, Any], customer_phone: str
) -> str:
    """Ejecuta una tool solicitada por Claude y devuelve el resultado serializable."""
    # Persistencia oportunista del nombre: cualquier tool que lo reciba lo guarda.
    # Si la tool falla después, el nombre ya quedó — es info barata que no conviene perder.
    nombre_oportunista = tool_input.get("customer_name") or (
        tool_input.get("nombre") if tool_name == "recordar_cliente" else None
    )
    if nombre_oportunista and customer_phone:
        try:
            await actualizar_nombre_cliente(tenant.id, customer_phone, nombre_oportunista)
        except Exception:
            logger.exception(
                "no se pudo persistir customer_name",
                extra={"tenant_slug": tenant.slug, "event": "name_persist_error"},
            )

    try:
        if tool_name == "recordar_cliente":
            # El UPDATE ya lo hizo el bloque oportunista. Devolvemos ok para Claude.
            return json.dumps({"ok": True, "saved": bool(nombre_oportunista)})

        if tool_name == "crear_pedido":
            order = await crear_pedido(
                tenant_slug=tenant.slug,
                items=tool_input.get("items", []),
                customer_phone=customer_phone,
                customer_name=tool_input.get("customer_name"),
                table_number=tool_input.get("table_number"),
                notes=tool_input.get("notes"),
            )
            link = await obtener_link_pago(order["orderId"])
            result: dict[str, Any] = {
                "ok": True,
                "order_id": order["orderId"],
                "total_eur": order["totalCents"] / 100,
                "currency": order["currency"],
            }
            kind = link.get("kind")
            if kind == "online":
                result["payment_mode"] = "online"
                result["payment_url"] = link.get("url")
                result["instruccion_al_cliente"] = (
                    "Confírmale el pedido y envíale el link de pago. "
                    "Recuérdale que pague antes de recoger/servir."
                )
            else:
                # kind == "offline" → Stripe desactivado o no configurado.
                result["payment_mode"] = "offline"
                result["payment_methods"] = link.get("paymentMethods", [])
                result["payment_notes"] = link.get("paymentNotes")
                result["instruccion_al_cliente"] = (
                    "Confírmale el pedido con el TOTAL y dile que pague usando uno "
                    "de los payment_methods disponibles (p.ej. al recoger, en efectivo). "
                    "NO menciones links de pago online — no están activos."
                )
            return json.dumps(result)

        if tool_name == "agendar_cita":
            result = await crear_cita(
                tenant_id=tenant.id,
                customer_phone=customer_phone,
                starts_at_iso=tool_input.get("starts_at_iso", ""),
                title=tool_input.get("title", ""),
                duration_min=int(tool_input.get("duration_min") or 30),
                customer_name=tool_input.get("customer_name"),
                notes=tool_input.get("notes"),
            )
            return json.dumps(result)

        if tool_name == "mis_citas":
            lim = int(tool_input.get("limit") or 5)
            citas = await listar_citas_del_cliente(tenant.id, customer_phone, limit=lim)
            return json.dumps({"ok": True, "count": len(citas), "citas": citas})

        if tool_name == "solicitar_humano":
            result = await crear_handoff(
                tenant_id=tenant.id,
                customer_phone=customer_phone,
                reason=tool_input.get("reason", ""),
                priority=tool_input.get("priority") or "normal",
                customer_name=tool_input.get("customer_name"),
            )
            return json.dumps(result)

        return json.dumps({"ok": False, "error": f"tool desconocida: {tool_name}"})
    except Exception as e:
        logger.exception(
            "tool falló",
            extra={"tenant_slug": tenant.slug, "event": "tool_error", "tool": tool_name},
        )
        return json.dumps({"ok": False, "error": str(e)[:300]})


async def generar_respuesta(
    tenant: TenantContext,
    mensaje_usuario: str,
    historial: list[dict],
    customer_phone: str = "",
    media_blocks: list[dict[str, Any]] | None = None,
) -> tuple[str, int, int]:
    """
    Devuelve (respuesta, tokens_in, tokens_out).
    `media_blocks` es una lista de content blocks tipo {"type":"image","source":{"type":"base64",...}}
    que se adjuntan al mensaje del usuario. Si hay media SIN texto, se mete un
    placeholder "Mira esta imagen" para que Claude tenga contexto textual.
    """
    texto_limpio = (mensaje_usuario or "").strip()
    has_media = bool(media_blocks)

    if not has_media and len(texto_limpio) < 2:
        return tenant.fallback_message, 0, 0

    if len(texto_limpio) > 8000:
        texto_limpio = texto_limpio[:8000]

    try:
        api_key = await obtener_anthropic_api_key(tenant.credentials)
    except Exception as e:
        logger.error(
            "no hay api_key disponible",
            extra={"tenant_slug": tenant.slug, "event": "api_key_missing"},
            exc_info=e,
        )
        return tenant.error_message, 0, 0

    client = _get_client(api_key)

    # Contexto persistente del cliente (nombre + último pedido + próxima cita).
    # Va como SEGUNDO bloque del system para no invalidar el cache del primero
    # (que sí es estable por tenant). Si falla, seguimos sin contexto — no bloquea.
    contexto_bloque: str | None = None
    if customer_phone:
        try:
            ctx = await obtener_contexto_cliente(tenant.id, customer_phone)
            contexto_bloque = _render_contexto_cliente(ctx)
        except Exception:
            logger.exception(
                "no se pudo cargar contexto persistente del cliente",
                extra={"tenant_slug": tenant.slug, "event": "ctx_load_error"},
            )

    # El historial ya viene normalizado (role/content). Anthropic content blocks
    # legacy (strings) siguen siendo válidos — aquí los dejamos como user/assistant
    # de texto puro para mantener compatibilidad.
    messages: list[dict[str, Any]] = [
        {"role": m["role"], "content": m["content"]} for m in historial
    ]
    if has_media:
        # Content blocks: primero las imágenes/media, luego texto (aunque sea placeholder).
        blocks: list[dict[str, Any]] = list(media_blocks or [])
        blocks.append({"type": "text", "text": texto_limpio or "Mira el archivo que te acabo de enviar."})
        messages.append({"role": "user", "content": blocks})
    else:
        messages.append({"role": "user", "content": texto_limpio})

    total_in = 0
    total_out = 0

    system_blocks: list[dict[str, Any]] = [
        {
            "type": "text",
            "text": tenant.system_prompt,
            "cache_control": {"type": "ephemeral"},
        }
    ]
    if contexto_bloque:
        # Bloque NO cacheado: cambia por usuario y tras cada pedido/cita.
        system_blocks.append({"type": "text", "text": contexto_bloque})

    try:
        for _ in range(MAX_TOOL_ITERATIONS):
            resp = await client.messages.create(
                model=MODEL_ID,
                max_tokens=MAX_TOKENS,
                system=system_blocks,
                messages=messages,
                tools=TOOLS,
            )
            total_in += resp.usage.input_tokens
            total_out += resp.usage.output_tokens

            if resp.stop_reason != "tool_use":
                # Respuesta final — extraer texto de todos los bloques text.
                texto_final = "".join(
                    block.text for block in resp.content if getattr(block, "type", None) == "text"
                ).strip()
                return texto_final or tenant.error_message, total_in, total_out

            # Claude pidió una tool. Registrar el assistant turn completo y ejecutar.
            messages.append({"role": "assistant", "content": resp.content})

            tool_results: list[dict[str, Any]] = []
            for block in resp.content:
                if getattr(block, "type", None) == "tool_use":
                    resultado = await _ejecutar_tool(tenant, block.name, block.input, customer_phone)
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": resultado,
                    })
            messages.append({"role": "user", "content": tool_results})
        # Se acabaron las iteraciones sin respuesta final.
        logger.warning(
            "tool loop agotó iteraciones",
            extra={"tenant_slug": tenant.slug, "event": "tool_loop_exhausted"},
        )
        return tenant.error_message, total_in, total_out
    except (APIStatusError, APIConnectionError) as e:
        logger.error(
            "claude api error",
            extra={"tenant_slug": tenant.slug, "event": "claude_error"},
            exc_info=e,
        )
        return tenant.error_message, total_in, total_out
    except Exception:
        logger.exception(
            "error inesperado en claude",
            extra={"tenant_slug": tenant.slug, "event": "claude_unexpected"},
        )
        return tenant.error_message, total_in, total_out
