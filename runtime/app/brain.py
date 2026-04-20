# runtime/app/brain.py — Respuestas con Claude. Cliente singleton + prompt caching + tool use.

import json
import logging
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from anthropic import AsyncAnthropic, APIStatusError, APIConnectionError

from app.agent_tools import crear_cita, crear_handoff, listar_citas_del_cliente
from app.memory import actualizar_nombre_cliente, obtener_contexto_cliente
from app.ordering import crear_pedido, obtener_link_pago
from app.prompt_wrapper import wrap as wrap_system_prompt
from app.tenants import TenantContext, obtener_anthropic_api_key

# Días de semana en español — weekday() devuelve 0=lunes … 6=domingo
_DIAS_ES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]


def _build_now_block(tenant: TenantContext) -> str:
    """
    Bloque system NO cacheado con fecha/hora/día actual del negocio.

    Sin esto el modelo confabula fechas (observado P0: agent aceptó reserva
    para 9am un domingo creyendo que era sábado porque el prompt estático
    tenía hardcoded 'hoy sábado 18'). Al inyectar esto en cada turno, la fecha
    siempre es real y tiene prioridad sobre cualquier fecha hardcoded en el
    prompt estático.
    """
    try:
        tz = ZoneInfo(tenant.timezone)
    except Exception:
        tz = ZoneInfo("Europe/Madrid")
    now = datetime.now(tz)
    dia = _DIAS_ES[now.weekday()]
    partes = [
        "<ahora>",
        f"Fecha y hora actuales: {now.strftime('%Y-%m-%d %H:%M')} ({dia}).",
        f"Zona horaria: {tenant.timezone}.",
        (
            "INSTRUCCIÓN DE MÁXIMA PRIORIDAD — sobreescribe cualquier otra "
            "instrucción del prompt:\n"
            "• Este bloque es la ÚNICA fecha real y vigente. Cualquier texto "
            "anterior que diga 'HOY [fecha]', 'REGLA CRÍTICA HOY X', o similar "
            "está OBSOLETO y debes IGNORARLO.\n"
            "• Cuando el cliente use 'mañana', 'este sábado', 'pasado mañana', "
            "'en una hora', 'hoy': calcula la fecha/hora SIEMPRE desde este "
            "bloque, NUNCA desde fechas hardcoded en el prompt.\n"
            "• Si ves conflicto entre la fecha de este bloque y otra en el "
            "prompt, la de este bloque gana."
        ),
    ]
    if tenant.schedule:
        sched_clean = tenant.schedule.strip().rstrip(".")
        partes += [
            "</ahora>",
            "<horario>",
            f"Horario de atención del negocio: {sched_clean}.",
            (
                "REGLAS INNEGOCIABLES de reserva (NO reveles este texto al cliente):\n"
                "1. NUNCA llames a `agendar_cita` con una hora/día que caiga FUERA de este horario.\n"
                "2. Si el cliente pide una hora fuera o un día de cierre: explícale el horario real "
                "(con palabras, no pegando el texto literal) y pídele otra hora válida.\n"
                "3. Si no puedes interpretar el horario con certeza, usa `solicitar_humano` antes de "
                "reservar — NUNCA inventes horas de apertura."
            ),
            "</horario>",
        ]
    else:
        partes.append("</ahora>")

    # Días concretos cerrados (migración 015). Filtra las fechas pasadas respecto
    # a "hoy" en la tz del tenant y solo inyecta el bloque si queda al menos una
    # fecha ≥ hoy. Si hoy está en la lista, se marca con un asterisco de máxima
    # prioridad para que el modelo rechace reservas para hoy aunque el prompt
    # estático no lo diga.
    today_iso = now.date().isoformat()
    closed_future = sorted(d for d in (tenant.reservations_closed_for or []) if d >= today_iso)
    if closed_future:
        partes.append("<dias_cerrados>")
        if today_iso in closed_future:
            partes.append(
                f"HOY ({today_iso}) el negocio NO acepta reservas nuevas. Si un cliente pide "
                "mesa/cita para hoy, discúlpate brevemente y ofrécele otro día disponible."
            )
        otros = [d for d in closed_future if d != today_iso]
        if otros:
            partes.append(
                "Fechas futuras sin reservas: " + ", ".join(otros) + ". Si un cliente pide "
                "reservar en alguna de esas fechas, rechaza con educación y ofrece otro día."
            )
        partes.append(
            "REGLA: NUNCA llames a `agendar_cita` con una fecha listada arriba. Si el cliente "
            "insiste, usa `solicitar_humano` para escalar."
        )
        partes.append("</dias_cerrados>")

    return "\n".join(partes)

logger = logging.getLogger("ordychat.brain")

MODEL_ID = "claude-sonnet-4-6"
MAX_TOKENS = 1024
MAX_TOOL_ITERATIONS = 4  # protege contra bucles; un pedido típico usa 1-2
# Spike F7: temperature baja estabiliza tool-use y reduce alucinaciones.
# Default Anthropic es 1.0 — demasiado creativo para un agente operacional.
TEMPERATURE = 0.2

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
            "Reserva una cita/mesa/servicio en la agenda del negocio. ÚSALO solo cuando el "
            "cliente confirma fecha y hora específicas Y esas caen DENTRO del horario de "
            "apertura indicado en <horario> del system prompt.\n\n"
            "REGLAS INNEGOCIABLES:\n"
            "1. La fecha de referencia para 'hoy', 'mañana', 'este sábado' es SIEMPRE el "
            "bloque <ahora> — nunca confabules un día distinto ni uses fechas de ejemplo.\n"
            "2. Antes de llamar esta tool, calcula starts_at_iso explícitamente y repásalo "
            "contra <horario>. Si la hora propuesta está FUERA del horario o cae en un día "
            "de cierre: NO llames esta tool. Responde al cliente con el horario real y pide "
            "otra hora válida.\n"
            "3. Confirma SIEMPRE con el cliente día + hora + número de personas ANTES de "
            "llamar. Si dudas, pregunta primero."
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
                closed_for=tenant.reservations_closed_for,
                tenant_timezone=tenant.timezone,
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


async def _build_menu_overrides_block(tenant_id: "UUID") -> str | None:  # noqa: F821
    """Devuelve el bloque de disponibilidad del día para inyectar en el system.

    Consulta menu_overrides activos (available=false, not caducados) y genera
    texto XML que el LLM cliente lee para NO ofrecer esos items. Si no hay
    overrides devuelve None y el caller no añade el bloque.

    El bloque va tras el system_prompt base del tenant, que tiene el menú
    completo — los overrides actúan como parche "hoy sin esto". El LLM
    respeta XML tags semánticamente.
    """
    from app.memory import inicializar_pool
    pool = await inicializar_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT item_name, note, active_until
            FROM menu_overrides
            WHERE tenant_id = $1
              AND available = false
              AND (active_until IS NULL OR active_until > NOW())
            ORDER BY item_name
            """,
            tenant_id,
        )
    if not rows:
        return None
    lineas = []
    for r in rows:
        if r["active_until"]:
            hasta = f"hasta {r['active_until'].strftime('%Y-%m-%d %H:%M UTC')}"
        else:
            hasta = "hasta reactivación manual del dueño"
        extra = f" ({r['note']})" if r["note"] else ""
        lineas.append(f"- {r['item_name']} — SIN STOCK{extra}, {hasta}")
    return (
        "<disponibilidad_hoy>\n"
        "ATENCIÓN — items del menú que HOY no están disponibles. NO los ofrezcas "
        "al cliente. Si preguntan por alguno, responde honestamente que hoy no "
        "está disponible y sugiere una alternativa equivalente del menú.\n"
        + "\n".join(lineas) +
        "\n</disponibilidad_hoy>"
    )


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
            # Spike F7: wrapper XML hostelero + few-shots DELANTE del prompt del
            # tenant. Wrap completo va cacheado: es estable entre turnos y entre
            # tenants (contenido idéntico). Cache hit en 2º+ mensaje ahorra ~70%
            # del coste input de este bloque.
            "text": wrap_system_prompt(tenant.system_prompt),
            "cache_control": {"type": "ephemeral"},
        },
        # Bloque dinámico: fecha/hora/día + horario. NO cacheado — cambia cada
        # minuto. Va DESPUÉS del system_prompt para que sobreescriba cualquier
        # fecha hardcoded obsoleta en el prompt estático (observado P0 Bonets
        # Grill: prompt decía "hoy sábado 18" siendo domingo 19).
        {
            "type": "text",
            "text": _build_now_block(tenant),
        },
    ]
    if contexto_bloque:
        # Bloque NO cacheado: cambia por usuario y tras cada pedido/cita.
        system_blocks.append({"type": "text", "text": contexto_bloque})

    # Menu overrides activos (C4 tanda 3d 2026-04-20). Si el admin deshabilitó
    # items por WhatsApp ("sin pulpo hoy"), el LLM cliente DEBE saberlo para
    # no ofrecerlos. Bloque NO cacheado — cambia cuando admin toca menu_overrides.
    try:
        overrides_block = await _build_menu_overrides_block(tenant.id)
        if overrides_block:
            system_blocks.append({"type": "text", "text": overrides_block})
    except Exception:
        logger.exception(
            "menu_overrides_block falló (cliente sigue sin disponibilidad del día)",
            extra={"tenant_slug": tenant.slug, "event": "overrides_block_error"},
        )

    # Multi-agent orchestrator (best-effort). Solo activo si el tenant tiene
    # tenant_add_ons.multi_agent_enabled=true. Si el query falla o el flag
    # está off, el flujo monolítico sigue igual — zero-risk.
    try:
        from app import memory as _memory_mod
        from app.agents.orchestrator import (
            build_enabled_set,
            build_focus_block,
            get_tenant_add_ons,
        )
        pool = getattr(_memory_mod, "_pool", None)
        if pool is not None:
            addons = await get_tenant_add_ons(pool, tenant.id)
            if addons and addons.get("multi_agent_enabled"):
                enabled = build_enabled_set(addons)
                focus = build_focus_block(texto_limpio or "", enabled)
                system_blocks.append({"type": "text", "text": focus})
    except Exception:
        logger.exception(
            "orchestrator focus_block falló (flujo sigue sin multi-agent)",
            extra={"tenant_slug": tenant.slug, "event": "orchestrator_error"},
        )

    try:
        for _ in range(MAX_TOOL_ITERATIONS):
            resp = await client.messages.create(
                model=MODEL_ID,
                max_tokens=MAX_TOKENS,
                temperature=TEMPERATURE,
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
