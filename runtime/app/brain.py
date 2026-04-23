# runtime/app/brain.py — Respuestas con Claude. Cliente singleton + prompt caching + tool use.

import json
import logging
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from anthropic import AsyncAnthropic, APIStatusError, APIConnectionError

from app.agent_tools import (
    cancelar_cita,
    crear_cita,
    crear_handoff,
    listar_citas_del_cliente,
    modificar_pedido,
    obtener_pedido_pendiente_eta,
    pedir_cuenta,
    responder_eta_pedido,
)
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


# Placeholders que compartimos entre múltiples visitantes anónimos (widget
# público /m/<slug>, playground admin). No identifican a un cliente real —
# por tanto NUNCA debemos hidratar contexto persistente (nombre/pedido/
# cita) contra ellos, o un visitante recibe datos de otro (incidente prod
# 2026-04-23: bot saludaba "Hola Mario" a todos los clientes de Bonets
# porque un tester había escrito su nombre bajo playground-sandbox, y
# confabulaba "tu reserva de esta noche" por una cita de test del mismo
# phone compartido).
_ANONYMOUS_PHONE_SENTINELS: frozenset[str] = frozenset({"playground-sandbox"})


def _is_anonymous_session(phone: str | None) -> bool:
    """True si el phone no identifica a un cliente único. Los sentinels
    compartidos y cualquier phone que no sea E.164 (no empieza con '+')
    se tratan como anónimos — sin contexto persistente, sin guardar nombre."""
    if not phone:
        return True
    if phone in _ANONYMOUS_PHONE_SENTINELS:
        return True
    if phone.startswith("playground-"):
        return True
    return False


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
            "ÚSALO solo cuando el cliente ha confirmado: (a) si es para comer aquí o "
            "para llevar, (b) si comer aquí, el número de mesa, (c) si para llevar, su "
            "nombre, (d) los productos exactos. Extrae precios del menú del restaurante "
            "que tienes en tu contexto. Si no estás seguro de un precio, pregunta al "
            "cliente antes de llamar la tool. NO llames la tool con datos a medias.\n\n"
            "El pedido entra en estado 'pending_kitchen_review' — la cocina debe "
            "aceptarlo con un tiempo (ETA). Luego el cliente confirma el tiempo y "
            "el pedido pasa a preparación. NO digas al cliente 'pedido confirmado' "
            "tras llamar esta tool — di 'pedido enviado a cocina, te confirmo el "
            "tiempo en seguida'."
        ),
        "input_schema": {
            "type": "object",
            "required": ["order_type", "items"],
            "properties": {
                "order_type": {
                    "type": "string",
                    "enum": ["dine_in", "takeaway"],
                    "description": "OBLIGATORIO. 'dine_in' si el cliente come aquí en el local (requiere table_number). 'takeaway' si es para llevar/recoger (requiere customer_name). NO inventes — pregúntale primero al cliente.",
                },
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
                "table_number": {"type": "string", "description": "REQUERIDO si order_type='dine_in'. Número de mesa donde está sentado el cliente."},
                "customer_name": {"type": "string", "description": "REQUERIDO si order_type='takeaway'. Nombre para llamar al cliente cuando esté listo."},
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
        "name": "cancelar_cita",
        "description": (
            "Cancela una reserva/cita del cliente. ÚSALO cuando el cliente diga "
            "'cancelar mi reserva', 'anular la mesa', 'no podré ir', etc. "
            "Efectos: UPDATE status='cancelada' en DB + WA al equipo del "
            "restaurante con los detalles de la cancelación. Tras llamar, "
            "confirma al cliente con una frase cálida que quedó cancelada y "
            "que el equipo ya fue avisado."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "appointment_id": {
                    "type": "string",
                    "description": "ID específico de la cita. Si no lo tienes, omítelo y cancelaremos la próxima futura.",
                },
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
        "name": "pedir_cuenta",
        "description": (
            "Fase 3 sesión de mesa: cuando el cliente (desde el menú QR en "
            "mesa) pide la cuenta. Solo funciona si al menos un pedido de "
            "esa mesa ya fue aceptado por cocina (session.status='active'). "
            "Si cocina aún no aceptó, la tool devuelve error y el bot debe "
            "explicar que aún no hay nada que cobrar. Si ya se pidió la "
            "cuenta antes, la tool devuelve already_requested=True y el bot "
            "tranquiliza al cliente. "
            "Al dispararse: transiciona la sesión a 'billing', pone "
            "bill_requested_at=now(), y manda WhatsApp al camarero "
            "(agent_configs.handoff_whatsapp_phone) con la mesa y el total."
        ),
        "input_schema": {
            "type": "object",
            "required": ["table_number"],
            "properties": {
                "table_number": {
                    "type": "string",
                    "description": "Número de mesa del cliente (viene del contexto <mesa>)",
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
            "tienes información para responder con certeza. "
            "Después de llamar esta tool, confirma al cliente en UNA SOLA frase corta "
            "que alguien del equipo le escribirá pronto. Dilo SOLO EN ESE TURNO — "
            "NO repitas el aviso en los mensajes siguientes. "
            "En turnos posteriores sigue atendiendo preguntas factuales del cliente "
            "con normalidad: horario, carta, alergias, dirección, reservas existentes. "
            "El humano tomará el relevo cuando esté disponible; mientras tanto tú "
            "sigues ayudando. NO contestes 'alguien te escribirá' a cada mensaje."
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
    {
        "name": "responder_eta_pedido",
        "description": (
            "ÚSALA SOLO cuando el contexto incluye <pedido_pendiente_eta> y el cliente está "
            "respondiendo a la propuesta de tiempo de preparación que cocina envió. "
            "Detecta la intención del cliente: si acepta el ETA (responde 'sí', 'vale', 'ok', "
            "'perfecto', 'me parece bien', 'de acuerdo', 'genial' o similar) → accepted=true. "
            "Si rechaza el ETA (responde 'no', 'mucho tiempo', 'demasiado', 'cancela', "
            "'mejor no' o similar) → accepted=false. "
            "Tras esta tool: confirma al cliente. Si accepted=true di 'perfecto, te avisamos "
            "cuando esté listo'. Si accepted=false di 'sin problema, hemos cancelado el pedido'. "
            "NO uses esta tool si el cliente está pidiendo otra cosa (carta, horario, nuevo pedido) "
            "— en ese caso responde a esa pregunta y no llames la tool."
        ),
        "input_schema": {
            "type": "object",
            "required": ["accepted"],
            "properties": {
                "accepted": {
                    "type": "boolean",
                    "description": "true si el cliente confirma el tiempo de preparación, false si lo rechaza.",
                },
            },
        },
    },
    {
        "name": "consultar_carta",
        "description": (
            "Busca items de la carta del negocio por nombre (acepta typos y variaciones). "
            "ÚSALA cuando el cliente pregunta por un plato/bebida específico que no encuentras "
            "en la carta inyectada en el system block o cuando tienes duda del nombre exacto. "
            "Devuelve hasta 5 matches con name, price_eur, category, description. Si query "
            "devuelve 0 matches, responde al cliente que ese item no está en la carta y ofrece "
            "alternativas. Si devuelve >1 matches similares, pregunta cuál quería."
        ),
        "input_schema": {
            "type": "object",
            "required": ["query"],
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Texto a buscar (puede tener typos). Ej: 'Dakota', 'cerveza alemana', 'sin gluten'.",
                    "minLength": 2,
                    "maxLength": 60,
                },
            },
        },
    },
    {
        "name": "mostrar_producto",
        "description": (
            "Muestra al cliente una TARJETA VISUAL de un producto concreto: "
            "imagen, descripción y alérgenos. El frontend renderiza la "
            "tarjeta debajo de tu mensaje de texto.\n\n"
            "ÚSALA cuando el cliente pregunta por un item específico "
            "('¿tenéis la Dakota?', 'enséñame la Kentucky') o cuando le "
            "recomiendas UN plato concreto y quieres que lo vea. "
            "UNA tarjeta por tool-call — si recomiendas 3 platos, llama "
            "la tool 3 veces.\n\n"
            "NO la llames para categorías genéricas ('enséñame las "
            "hamburguesas') ni para items que no existan en <carta>. "
            "Si el cliente pide algo ambiguo, primero usa consultar_carta "
            "para desambiguar y luego mostrar_producto con el nombre exacto."
        ),
        "input_schema": {
            "type": "object",
            "required": ["item_name"],
            "properties": {
                "item_name": {
                    "type": "string",
                    "description": (
                        "Nombre EXACTO del item tal como aparece en <carta>. "
                        "Ej: 'Dakota Burger', 'Kentucky Burger', 'Coca-Cola'."
                    ),
                    "minLength": 2,
                    "maxLength": 200,
                },
            },
        },
    },
    {
        "name": "modificar_pedido",
        "description": (
            "Añade un cambio al ÚLTIMO pedido que el cliente acaba de hacer, SIEMPRE "
            "Y CUANDO la cocina aún no lo haya aceptado/rechazado. Úsala cuando el "
            "cliente pide quitar, cambiar, añadir o ajustar algo DESPUÉS de haber "
            "confirmado un pedido (ejemplos: 'sin cebolla en la Dakota', 'que sea "
            "smash en vez de medallón', 'añade unas papas', 'cambia la Kentucky "
            "por otra Dakota').\n\n"
            "REGLA CRÍTICA: si el cliente ya hizo un pedido en esta conversación "
            "y ahora pide un cambio, NUNCA llames crear_pedido otra vez — eso "
            "generaría un pedido DUPLICADO en cocina. Siempre usa modificar_pedido "
            "con el cambio del cliente.\n\n"
            "Si la tool devuelve 'pedido_ya_en_preparacion' quiere decir que la "
            "cocina ya aceptó el pedido anterior y no puedes modificarlo. En ese "
            "caso discúlpate con el cliente: 'Lo sentimos mucho, el pedido ya "
            "está en preparación y no podemos cambiarlo.' Ofrécele hacer un "
            "pedido nuevo si es para otro turno. "
            "Si devuelve 'no_hay_pedido' (el cliente nunca había pedido nada en "
            "este tenant), usa crear_pedido normalmente."
        ),
        "input_schema": {
            "type": "object",
            "required": ["change_request"],
            "properties": {
                "change_request": {
                    "type": "string",
                    "description": (
                        "Lo que el cliente quiere cambiar en sus propias palabras "
                        "(ej 'sin cebolla acaramelada en la Dakota', 'añade unas "
                        "papas grandes', 'cambia la Kentucky por Dakota'). Frase "
                        "breve y clara; la cocina la verá literal en la card KDS."
                    ),
                    "minLength": 3,
                    "maxLength": 500,
                },
                "customer_name": {
                    "type": "string",
                    "description": "Nombre del cliente si lo sabes (para identificarlo en el aviso a cocina).",
                },
            },
        },
    },
]


async def _ejecutar_tool(
    tenant: TenantContext,
    tool_name: str,
    tool_input: dict[str, Any],
    customer_phone: str,
    sandbox: bool = False,
    cards_sink: list[dict[str, Any]] | None = None,
) -> str:
    """Ejecuta una tool solicitada por Claude y devuelve el resultado serializable.

    Mig 029: el modo sandbox ya NO devuelve stubs JSON. Cada tool se ejecuta
    REAL pasando is_test=True a los INSERT, lo que marca las filas como de
    prueba (`orders.is_test`, `appointments.is_test`, `handoff_requests.is_test`,
    `conversations.is_test`). Los dashboards filtran is_test=false por defecto
    y muestran las filas de prueba solo con el toggle "🧪 Incluir pruebas".
    Los workers proactivos WA saltan is_test=true para no intentar enviar a
    `customer_phone="playground-sandbox"`.

    Con esto el playground se vuelve útil end-to-end: Mario puede validar
    que el pedido llega al KDS, la reserva aparece en /agent/reservations,
    la conversación queda en /dashboard/conversations — sin contaminar
    métricas reales.
    """
    is_test = bool(sandbox)

    # Persistencia oportunista del nombre: cualquier tool que lo reciba lo guarda.
    # Si la tool falla después, el nombre ya quedó — es info barata que no conviene perder.
    # En sandbox marcamos la conversación con is_test=true (solo aplica al INSERT inicial).
    nombre_oportunista = tool_input.get("customer_name") or (
        tool_input.get("nombre") if tool_name == "recordar_cliente" else None
    )
    if (
        nombre_oportunista
        and customer_phone
        and not _is_anonymous_session(customer_phone)
    ):
        # Nunca persistimos el nombre contra placeholders compartidos
        # (playground-sandbox, etc.). Si lo hiciéramos, el siguiente visitante
        # anónimo recibiría "Hola <nombre ajeno>".
        try:
            await actualizar_nombre_cliente(
                tenant.id, customer_phone, nombre_oportunista, is_test=is_test
            )
        except Exception:
            logger.exception(
                "no se pudo persistir customer_name",
                extra={"tenant_slug": tenant.slug, "event": "name_persist_error"},
            )

    try:
        if tool_name == "recordar_cliente":
            # El UPDATE ya lo hizo el bloque oportunista. Devolvemos ok para Claude.
            return json.dumps({"ok": True, "saved": bool(nombre_oportunista), "is_test": is_test})

        if tool_name == "crear_pedido":
            # Guards server-side de los campos condicionalmente requeridos.
            # Defienden contra el modelo que ignora la description del tool y llama
            # con datos faltantes. Devolvemos error parseable que Claude convierte
            # en pregunta al cliente.
            order_type = (tool_input.get("order_type") or "takeaway").lower()
            if order_type not in ("dine_in", "takeaway"):
                return json.dumps({
                    "ok": False,
                    "error": "order_type_invalido",
                    "hint": "order_type debe ser 'dine_in' (comer aquí) o 'takeaway' (llevar). Pregúntale al cliente.",
                })
            table_num = (tool_input.get("table_number") or "").strip() or None
            customer_nm = (tool_input.get("customer_name") or "").strip() or None
            if order_type == "dine_in" and not table_num:
                return json.dumps({
                    "ok": False,
                    "error": "falta_table_number",
                    "hint": "Para comer aquí necesitas el número de mesa. Pregúntale al cliente '¿en qué mesa estás?' antes de llamar la tool otra vez.",
                })
            if order_type == "takeaway" and not customer_nm:
                return json.dumps({
                    "ok": False,
                    "error": "falta_customer_name",
                    "hint": "Para llevar necesitas el nombre del cliente. Pregúntale '¿a qué nombre lo recoges?' antes de llamar la tool otra vez.",
                })
            order = await crear_pedido(
                tenant_slug=tenant.slug,
                items=tool_input.get("items", []),
                customer_phone=customer_phone,
                customer_name=customer_nm,
                table_number=table_num,
                notes=tool_input.get("notes"),
                order_type=order_type,
                is_test=is_test,
            )
            # Mig 027 workflow: el pedido entró en pending_kitchen_review. NO generamos
            # link de pago aquí — eso pasa cuando el cliente confirma el ETA propuesto
            # por cocina (Fase 6). El bot debe decirle al cliente que el pedido está
            # en cocina y que le confirmará el tiempo en seguida.
            result: dict[str, Any] = {
                "ok": True,
                "order_id": order["orderId"],
                "total_eur": order["totalCents"] / 100,
                "currency": order["currency"],
                "status": "pending_kitchen_review",
                "instruccion_al_cliente": (
                    "Confirma al cliente que su pedido fue ENVIADO A COCINA con el "
                    "TOTAL en euros. Dile que en cuanto cocina lo acepte le confirmas "
                    "el TIEMPO DE PREPARACIÓN. NO le digas 'pedido confirmado', NO le "
                    "ofrezcas link de pago todavía — eso viene después de que cocina "
                    "acepte y el cliente confirme el tiempo."
                ),
            }
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
                is_test=is_test,
            )
            return json.dumps(result)

        if tool_name == "cancelar_cita":
            result = await cancelar_cita(
                tenant_id=tenant.id,
                customer_phone=customer_phone,
                appointment_id=tool_input.get("appointment_id") or None,
                sandbox=is_test,
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
                sandbox=is_test,
            )
            return json.dumps(result)

        if tool_name == "pedir_cuenta":
            result = await pedir_cuenta(
                tenant_id=tenant.id,
                table_number=str(tool_input.get("table_number") or ""),
                sandbox=is_test,
            )
            return json.dumps(result)

        if tool_name == "responder_eta_pedido":
            accepted = bool(tool_input.get("accepted"))
            result = await responder_eta_pedido(
                tenant_id=tenant.id,
                customer_phone=customer_phone,
                accepted=accepted,
            )
            return json.dumps(result)

        if tool_name == "modificar_pedido":
            result = await modificar_pedido(
                tenant_id=tenant.id,
                customer_phone=customer_phone,
                change_request=tool_input.get("change_request", ""),
                customer_name=tool_input.get("customer_name"),
                is_test=is_test,
            )
            return json.dumps(result)

        if tool_name == "consultar_carta":
            from app.menu_search import buscar_items
            query = (tool_input.get("query") or "").strip()
            if len(query) < 2:
                return json.dumps({"ok": False, "error": "query muy corta (min 2 chars)"})
            results = await buscar_items(tenant.id, query, limit=5)
            return json.dumps({"ok": True, "query": query, "count": len(results), "results": results})

        if tool_name == "mostrar_producto":
            # Busca el item por nombre exacto o fuzzy, construye una card
            # estructurada y la emite al frontend via cards_sink. Devuelve
            # a Claude solo un confirm (para que siga escribiendo texto
            # sin repetir lo que ya muestra la card).
            from app.menu_search import buscar_items

            item_name = (tool_input.get("item_name") or "").strip()
            if len(item_name) < 2:
                return json.dumps({"ok": False, "error": "item_name requerido"})
            results = await buscar_items(tenant.id, item_name, limit=1)
            if not results:
                return json.dumps({
                    "ok": False,
                    "error": "item_not_found",
                    "detail": f"'{item_name}' no está en la carta",
                })
            top = results[0]
            card = {
                "type": "item",
                "name": top.get("name"),
                "price_eur": top.get("price_eur"),
                "category": top.get("category"),
                "description": top.get("description"),
                "image_url": top.get("image_url"),
                "allergens": top.get("allergens") or [],
            }
            if cards_sink is not None:
                cards_sink.append(card)
            return json.dumps({
                "ok": True,
                "showed": card["name"],
                "has_image": bool(card.get("image_url")),
                "has_allergens": bool(card.get("allergens")),
            })

        return json.dumps({"ok": False, "error": f"tool desconocida: {tool_name}"})
    except Exception as e:
        logger.exception(
            "tool falló",
            extra={"tenant_slug": tenant.slug, "event": "tool_error", "tool": tool_name},
        )
        return json.dumps({"ok": False, "error": str(e)[:300]})


async def _build_agent_rules_block(tenant_id: "UUID") -> str | None:  # noqa: F821
    """Reglas duras del tenant (tabla agent_rules). Se inyectan como bloque
    <reglas_duras> en el system_prompt y el LLM las trata como no-negociables.

    Diferencia con menu_overrides: las overrides son time-bounded + item-level
    ("hoy sin Dakota"). Las reglas son permanentes + operativas
    ("15 min antes del cierre solo para llevar", "nunca aceptes reservas
    de más de 8 personas", "siempre ofrece postre tras el plato fuerte").
    """
    from app.memory import inicializar_pool
    pool = await inicializar_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT rule_text
            FROM agent_rules
            WHERE tenant_id = $1 AND active = true
            ORDER BY priority DESC, created_at
            LIMIT 40
            """,
            tenant_id,
        )
    if not rows:
        return None
    lineas = [f"- {r['rule_text']}" for r in rows]
    return (
        "<reglas_duras>\n"
        "Estas son reglas operativas del negocio. Son NO NEGOCIABLES — debes "
        "respetarlas siempre, aunque el cliente insista. Si una respuesta tuya "
        "violaría una regla, reformula para no violarla o explica amablemente "
        "por qué no puedes.\n"
        + "\n".join(lineas) +
        "\n</reglas_duras>"
    )


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


async def _build_menu_block(tenant_id: "UUID") -> str | None:  # noqa: F821
    """Mig 028 Fase B: devuelve el bloque <carta> con todos los items
    available=true del tenant agrupados por categoría con precio.

    Reemplaza la práctica antigua de pegar la carta como texto libre dentro
    del system_prompt. Ventajas:
      - Single source of truth (menu_items table).
      - Precios siempre frescos: si el tenant edita un item en /dashboard/carta
        (Fase C), el siguiente turno del bot ya lee el cambio.
      - Permite tool consultar_carta(query) con fuzzy match server-side.

    Formato compacto: máximo ~3KB por tenant medio (60-80 items).
    """
    from app.memory import inicializar_pool
    pool = await inicializar_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT category, name, price_cents, description
            FROM menu_items
            WHERE tenant_id = $1 AND available = true
            ORDER BY category, sort_order, name
            """,
            tenant_id,
        )
    if not rows:
        return None
    # Agrupar por categoría manteniendo orden de aparición.
    por_categoria: dict[str, list[dict]] = {}
    orden_cat: list[str] = []
    for r in rows:
        cat = r["category"] or "Otros"
        if cat not in por_categoria:
            por_categoria[cat] = []
            orden_cat.append(cat)
        por_categoria[cat].append({"name": r["name"], "price_cents": r["price_cents"], "desc": r["description"]})

    lineas = ["<carta>"]
    lineas.append(
        "Esta es la carta vigente del negocio (fuente de verdad — usa estos "
        "precios y nombres EXACTOS, no inventes ni cambies). Si el cliente "
        "menciona un item con typo (Dakota → Dacoka, etc.), interpretalo como "
        "el más parecido de esta lista."
    )
    for cat in orden_cat:
        lineas.append(f"\n### {cat}")
        for it in por_categoria[cat]:
            precio = f"{it['price_cents'] / 100:.2f} €".replace(".", ",")
            base = f"- {it['name']} — {precio}"
            if it["desc"]:
                # Trunca descripción para no inflar tokens (max 300 chars —
                # el mesero necesita conocer ingredientes, alérgenos y tamaño).
                d = it["desc"].strip()
                if len(d) > 300:
                    d = d[:297] + "…"
                base += f" ({d})"
            lineas.append(base)
    lineas.append("</carta>")
    return "\n".join(lineas)


def _build_post_cuenta_block(tenant: TenantContext) -> str | None:
    """Bloque post-cuenta (mig 033): cuando el cliente ya pidió/pagó la
    cuenta, el agente se despide con agradecimiento + enlaces de reseña
    + redes sociales del tenant.

    Devuelve None si el tenant no configuró NINGÚN enlace (no tiene nada
    que compartir; el agente simplemente agradece).
    """
    bits: list[str] = []
    if tenant.review_google_url:
        bits.append(f"- Reseña Google: {tenant.review_google_url}")
    if tenant.review_tripadvisor_url:
        bits.append(f"- Reseña TripAdvisor: {tenant.review_tripadvisor_url}")
    socials: list[str] = []
    if tenant.social_instagram_url:
        socials.append(f"Instagram {tenant.social_instagram_url}")
    if tenant.social_facebook_url:
        socials.append(f"Facebook {tenant.social_facebook_url}")
    if tenant.social_tiktok_url:
        socials.append(f"TikTok {tenant.social_tiktok_url}")
    if not bits and not socials:
        return None
    lineas = ["<post_cuenta>"]
    lineas.append(
        "El cliente ya pidió la cuenta o ya pagó. Tu próxima respuesta (o "
        "cuando el cliente diga 'gracias', 'adiós', 'hasta luego', etc.) "
        "debe ser una despedida CÁLIDA Y BREVE (1-2 frases) que incluya:"
    )
    if bits:
        lineas.append(
            "1. Una mención EDUCADA a la reseña. Ejemplo: "
            "'Si os ha gustado, un detalle enorme sería una reseña 🙏'. "
            "Incluye los enlaces literalmente — el cliente los tocará en el "
            "chat (NO los leas en voz alta, el TTS los filtra solo):"
        )
        lineas.extend(bits)
    if socials:
        lineas.append(
            "2. Comparte nuestras redes sociales para que nos sigan: "
            + " · ".join(socials)
        )
    lineas.append(
        "REGLAS: (a) UNA SOLA mención — no insistas en los siguientes turnos; "
        "(b) NO dupliques enlaces si ya los mencionaste en un turno anterior; "
        "(c) tono natural, no parezcas spam."
    )
    lineas.append("</post_cuenta>")
    return "\n".join(lineas)


def _build_menu_web_flow_block(
    mesa: str,
    drinks_pitch: str = "",
    session_status: str | None = None,
    historial_len: int = 0,
) -> str:
    """Bloque system para el flujo 'bebidas primero' cuando el cliente abre
    /m/<slug>?mesa=N (QR de mesa). Se inyecta solo si channel=menu_web.

    Regla de negocio: mientras el cliente mira la carta, las bebidas pueden ir
    preparándose en el bar. El bot abre pidiendo bebidas para aprovechar ese
    tiempo muerto, luego añade la comida por modificar_pedido.

    CONTEXT-AWARE (fix 2026-04-23): antes el bloque decía literalmente "TU
    PRIMER TURNO" — el bot lo leía también turnos 2/3/4 y "reiniciaba" el
    saludo como si el cliente acabara de llegar. Ahora distinguimos la
    fase por `session_status` (pasado desde generar_respuesta):
      - None o "pending" sin historial → fase bienvenida (saludo + mesa + bebidas).
      - "pending"/"active"/"billing" con historial → fase ayudar-en-marcha.
      - "paid"/"closed" → fase post-pago, cerrar con naturalidad.
    """
    mesa_linea = (
        f"<mesa>{mesa}</mesa>"
        if mesa
        else "<mesa>NO INDICADA — si aún no la has preguntado, pregúntasela y confírmala antes de crear pedido</mesa>"
    )
    pitch_clean = (drinks_pitch or "").strip()
    if pitch_clean:
        pitch_clean = pitch_clean[:500]
        bebidas_linea = (
            f"<bebidas_curadas>\n{pitch_clean}\n</bebidas_curadas>\n"
            "INSTRUCCIÓN RÍGIDA cuando ofrezcas bebidas de entrada: ofrece "
            "EXACTAMENTE las bebidas de <bebidas_curadas>. NO inventes otras, "
            "NO sugieras del resto de la carta en la oferta inicial. Si el "
            "cliente pide una bebida fuera de <bebidas_curadas> pero sí en la "
            "<carta>, sírvela sin problema.\n"
        )
    else:
        bebidas_linea = ""

    # Fase del flujo. `session_status` es autoritativo; `historial_len` es un
    # backup defensivo (si el runtime no pudo leer la sesión).
    is_welcome = (
        (session_status is None or session_status == "pending") and historial_len == 0
    )
    is_post_paid = session_status in ("paid", "closed")

    if is_welcome:
        flujo = (
            "<flujo_carta_qr fase='bienvenida'>\n"
            "El cliente acaba de escanear el QR y abrió el chat. Este ES el "
            "primer turno y no hay conversación previa.\n"
            "EN ESTE TURNO debes (orden estricto):\n"
            "1. Saludo breve (una línea), en el idioma del cliente.\n"
            "2. Si <mesa> trae número, CONFÍRMALA literalmente "
            "('Estáis en la mesa X, ¿correcto?'). Si dice NO INDICADA, "
            "pregunta '¿en qué mesa estáis?' y espera respuesta.\n"
            + (
                "3. Ofrece las bebidas de <bebidas_curadas> LITERALMENTE. "
                "Frase tipo '¿Os apetece algo para beber mientras miráis la "
                "carta? Tenemos [texto curado].' NO listes comida todavía.\n"
                if pitch_clean
                else "3. Pregunta al cliente qué bebida le apetece abierto, "
                "tipo '¿Os apetece algo para beber mientras miráis la carta?'. "
                "NO listes comida todavía.\n"
            )
            + "</flujo_carta_qr>"
        )
    elif is_post_paid:
        flujo = (
            "<flujo_carta_qr fase='post_pago'>\n"
            "La mesa ya está pagada. NO crees más pedidos. Si el cliente "
            "escribe, responde con naturalidad (agradecer, invitar a volver, "
            "responder a dudas), pero no insinúes que se puede seguir "
            "pidiendo — la cuenta está cerrada.\n"
            "</flujo_carta_qr>"
        )
    else:
        # En marcha: ya hay pedido o conversación previa. NO reinicies el
        # saludo, NO preguntes mesa otra vez (ya la tienes en <mesa>), NO
        # vuelvas a ofrecer bebidas por defecto. Instrucciones fortalecidas
        # 2026-04-23 tras ver al bot olvidar items entre turnos y duplicar
        # preguntas (conversación Bonets 10:19-10:20): bot olvidó la Dakota
        # ya pedida, preguntó 2× "¿para aquí o para llevar?", respondió "¡Hola!"
        # a un "gracias". Fix: reglas de MEMORIA + CONSOLIDACIÓN explícitas.
        flujo = (
            "<flujo_carta_qr fase='en_marcha'>\n"
            "La conversación con este cliente YA está en curso. Antes de "
            "responder, lee TODO el historial de mensajes y construye "
            "mentalmente el estado actual:\n"
            "  • order_type confirmado (dine_in/takeaway): ¿lo dijo ya en "
            "algún turno? Si sí, NO vuelvas a preguntar.\n"
            "  • mesa confirmada: está en <mesa>. NO la pidas otra vez.\n"
            "  • items mencionados por el cliente a lo largo de la "
            "conversación: ACUMÚLALOS mentalmente. Son el pedido en "
            "construcción. No los pierdas entre turnos.\n"
            "\n"
            "REGLAS DURAS:\n"
            "1. NO saludes de nuevo ('hola', 'bienvenido') a mitad de "
            "conversación. Si el cliente dice 'gracias' / 'ok' / 'perfecto', "
            "confirma o cierra con naturalidad — NUNCA respondas con un "
            "saludo desde cero.\n"
            "2. NO repitas una pregunta que el cliente YA respondió en un "
            "turno anterior. Especialmente '¿para comer aquí o para llevar?' "
            "y '¿en qué mesa estáis?'.\n"
            "3. Si un mensaje del cliente es raro, vacío o parece un audio "
            "mal transcrito (ej. créditos de YouTube), responde 'No te "
            "entendí bien, ¿podéis repetirlo?' y CONTINÚA la conversación "
            "desde el punto donde estaba — NO reinicies el flujo.\n"
            "4. SALUDOS SOCIALES / FRASES CORTÍSIMAS ('un saludo', 'hola', "
            "'buenas', 'qué tal', 'muchas gracias', 'gracias', 'ok', "
            "'perfecto', 'vale'): reconócelas en UNA sola línea amable "
            "('¡Un saludo para ti también!', 'De nada', 'Perfecto') y SIGUE "
            "inmediatamente desde donde quedaste (repite la pregunta "
            "pendiente o confirma el siguiente paso). NUNCA respondas 'no "
            "te entendí' a un saludo social — es rudo y rompe la conversación.\n"
            "5. NUNCA INVENTES OPCIONES DE PERSONALIZACIÓN DE UN ITEM. "
            "Sólo puedes preguntar variantes (smash vs medallón, poco/muy "
            "hecha, tamaño pequeño/grande, etc.) SI esa variante aparece "
            "LITERAL en la descripción del item dentro de <carta>. Si un "
            "item sólo dice '200g carne' sin especificar estilo, NO "
            "preguntes 'smash o medallón' — ese item no tiene esa opción. "
            "Si dudas sobre una variación, asume lo que diga la <carta> y "
            "no abras opciones nuevas. Excepción: toppings que el cliente "
            "menciona explícitamente ('sin cebolla', 'extra bacon') se "
            "aceptan como nota del pedido aunque no estén en la descripción.\n"
            "\n"
            "MOSTRAR PRODUCTO (visual): cuando el cliente menciona UN plato "
            "concreto por su nombre ('quiero una Kentucky', 'la Dakota', "
            "'la Coca-Cola') o cuando le recomiendas UN plato específico, "
            "llama mostrar_producto(item_name=<nombre exacto>) DESPUÉS "
            "de tu texto — el frontend renderizará una tarjeta con foto, "
            "descripción y alérgenos. NO la llames para categorías "
            "('las hamburguesas') ni para items ambiguos (usa consultar_carta "
            "primero si dudas del nombre). UNA tarjeta por item — si "
            "recomiendas 2 platos, llama la tool 2 veces con los nombres.\n"
            "\n"
            "CUÁNDO CREAR EL PEDIDO (crítico):\n"
            "En cuanto tengas los 3 datos — order_type + mesa + al menos 1 "
            "item — llama a crear_pedido(order_type='dine_in', "
            "table_number=<mesa>, items=[...]) SIN pedir más confirmaciones "
            "redundantes. Si el cliente añade algo más después → "
            "modificar_pedido con el order_id. NUNCA crear_pedido dos veces "
            "en la misma visita de mesa.\n"
            "\n"
            "Si pide la cuenta ('cuenta', 'cobrar', 'pagar') → tool "
            "pedir_cuenta(table_number=<mesa>).\n"
            "Si tiene una duda fuera del pedido (alergia, horario, baño) "
            "respóndela con naturalidad sin romper el contexto.\n"
            "</flujo_carta_qr>"
        )
    return (
        "<canal>menu_web</canal>\n"
        f"{mesa_linea}\n"
        f"<session_status>{session_status or 'none'}</session_status>\n"
        f"{bebidas_linea}"
        f"{flujo}\n"
        "\n"
        "<reglas_universales>\n"
        "CREAR EL PRIMER PEDIDO de la mesa: cuando tengas mesa confirmada + "
        "items confirmados por el cliente, llama crear_pedido con "
        "order_type='dine_in', table_number=<mesa>, items=[...]. NO pidas "
        "nombre ni teléfono — comen aquí.\n"
        "\n"
        "AÑADIR MÁS ITEMS tras el primer pedido: usa modificar_pedido con el "
        "order_id del pedido abierto. NUNCA llames crear_pedido dos veces en "
        "la misma visita de mesa.\n"
        "\n"
        "TRAS CUALQUIER PEDIDO: confirma con una frase corta tipo "
        "'Marchando para la mesa X'. NO digas 'pedido confirmado' ni recites "
        "items como factura.\n"
        "\n"
        "PEDIR LA CUENTA: cuando el cliente diga 'la cuenta', 'cobrar', "
        "'tráeme la cuenta', 'pagar', etc., llama pedir_cuenta(table_number=<mesa>):\n"
        "- error kitchen_not_accepted_yet → dile que en cuanto cocina acepte "
        "el primer pedido podrás cerrar la cuenta.\n"
        "- error no_active_session → dile que aún no ha pedido nada.\n"
        "- ok con already_requested=True → dile que el camarero ya está "
        "avisado y llega enseguida.\n"
        "- ok nuevo → confirma que avisaste al camarero, menciona el total_eur, "
        "dile que alguien pasará enseguida.\n"
        "\n"
        "CIERRE DEL PEDIDO (cuando el cliente diga 'nada más', 'es todo', "
        "'ya está', 'gracias eso es todo'): confirma CÁLIDAMENTE que su "
        "pedido fue enviado a cocina y que pronto estará disfrutando de su "
        "comida. Da las gracias por la visita. NO llames pedir_cuenta aquí "
        "— el cliente aún no ha pedido la cuenta, sólo cerró el pedido. "
        "Mantén el chat abierto: el cliente puede pedir más platos después, "
        "y cuando quiera la cuenta te lo dirá. NO cierres la sesión de mesa "
        "ni te despidas definitivamente; el flujo post-cuenta (con reseñas/"
        "redes) viene sólo cuando piden la cuenta.\n"
        "\n"
        "NO actives este flujo si el cliente claramente pide takeaway o para "
        "llevar desde el principio (raro vía QR de mesa pero posible).\n"
        "</reglas_universales>"
    )


async def generar_respuesta(
    tenant: TenantContext,
    mensaje_usuario: str,
    historial: list[dict],
    customer_phone: str = "",
    media_blocks: list[dict[str, Any]] | None = None,
    sandbox: bool = False,
    channel: str | None = None,
    table_number: str | None = None,
    cards_sink: list[dict[str, Any]] | None = None,
) -> tuple[str, int, int]:
    """
    Devuelve (respuesta, tokens_in, tokens_out).
    `media_blocks` es una lista de content blocks tipo {"type":"image","source":{"type":"base64",...}}
    que se adjuntan al mensaje del usuario. Si hay media SIN texto, se mete un
    placeholder "Mira esta imagen" para que Claude tenga contexto textual.

    `sandbox=True` (mig 029) ejecuta las tools de verdad pero marcando cada
    fila insertada con `is_test=true`. Dashboards filtran is_test=false por
    defecto; workers proactivos WA saltan is_test=true (para no intentar
    enviar WA a `customer_phone="playground-sandbox"`). Úsalo para playground
    tenant y validator seeds.
    """
    texto_limpio = (mensaje_usuario or "").strip()
    has_media = bool(media_blocks)

    # Solo descartamos texto vacío. Mensajes de 1 char ("1", "2", "a", "b") son
    # respuestas válidas en multi-turn ("¿cuántas hamburguesas?" → "1"). Antes
    # rechazábamos < 2 y eso rompía cualquier respuesta numérica corta.
    if not has_media and len(texto_limpio) == 0:
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
    #
    # Sólo para phones REALES (E.164). Los placeholders como
    # 'playground-sandbox' se comparten entre múltiples visitantes anónimos
    # del widget público: si leyéramos contexto allí, el visitante A recibiría
    # el nombre o la cita del visitante B. Anonymous → contexto vacío.
    contexto_bloque: str | None = None
    if customer_phone and not _is_anonymous_session(customer_phone):
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

    # Mig 028 Fase B: carta estructurada del tenant (menu_items). Inyectada antes
    # de menu_overrides para que las disponibilidades del día actúen como parche
    # encima de la carta base. Si el tenant aún no tiene menu_items cargados,
    # el bloque devuelve None y el flujo sigue con la carta legacy del system_prompt.
    try:
        carta_block = await _build_menu_block(tenant.id)
        if carta_block:
            system_blocks.append({"type": "text", "text": carta_block})
    except Exception:
        logger.exception(
            "menu_block falló (cliente sigue sin carta dinámica)",
            extra={"tenant_slug": tenant.slug, "event": "menu_block_error"},
        )

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

    # Reglas duras del tenant (2026-04-20). Reglas operativas persistentes que
    # el dueño quiere que el agente respete siempre (p.ej. "15 min antes del
    # cierre solo takeaway"). Se mete DESPUÉS de overrides porque las reglas
    # son más fuertes — reglas > disponibilidad > saludo/contexto.
    try:
        rules_block = await _build_agent_rules_block(tenant.id)
        if rules_block:
            system_blocks.append({"type": "text", "text": rules_block})
    except Exception:
        logger.exception(
            "agent_rules_block falló (cliente responde sin reglas duras)",
            extra={"tenant_slug": tenant.slug, "event": "rules_block_error"},
        )

    # Canal menu_web (QR en mesa): flujo "bebidas primero + KDS con mesa".
    # Cuando el cliente escanea el QR de su mesa y abre /m/<slug>?mesa=N,
    # la web pasa channel="menu_web" + table_number al runtime. El bot
    # debe saludar, confirmar mesa si falta, y pedir bebidas mientras el
    # cliente sigue mirando la carta. Luego crear_pedido(order_type=dine_in,
    # table_number=N, items=bebidas). Comida posterior → modificar_pedido.
    if channel == "menu_web":
        mesa_value = table_number.strip() if table_number else ""
        # Lookup estado de la sesión de mesa para saber en qué fase estamos
        # (bienvenida vs en_marcha vs post_paid). Best-effort: si falla, el
        # bloque se renderiza en modo "bienvenida" por defecto — mejor que
        # no inyectar nada.
        session_status_now: str | None = None
        if mesa_value:
            try:
                from app.memory import inicializar_pool

                pool = await inicializar_pool()
                async with pool.acquire() as conn:
                    row = await conn.fetchrow(
                        """
                        SELECT status FROM table_sessions
                        WHERE tenant_id = $1 AND table_number = $2
                          AND status IN ('pending','active','billing','paid','closed')
                        ORDER BY created_at DESC
                        LIMIT 1
                        """,
                        tenant.id, mesa_value,
                    )
                if row:
                    session_status_now = row["status"]
            except Exception:
                logger.exception(
                    "no se pudo leer session_status para menu_web flow",
                    extra={"tenant_slug": tenant.slug, "event": "session_status_lookup_error"},
                )
        system_blocks.append(
            {
                "type": "text",
                "text": _build_menu_web_flow_block(
                    mesa_value,
                    drinks_pitch=tenant.drinks_greeting_pitch,
                    session_status=session_status_now,
                    historial_len=len(historial),
                ),
            }
        )
        # Mig 033 post-cuenta: si la sesión de esta mesa está en billing/paid,
        # inyectamos el bloque <post_cuenta> con los enlaces del tenant.
        if mesa_value:
            try:
                from app.memory import inicializar_pool
                pool = await inicializar_pool()
                async with pool.acquire() as conn:
                    sess_row = await conn.fetchrow(
                        """
                        SELECT status FROM table_sessions
                        WHERE tenant_id = $1 AND table_number = $2
                          AND status IN ('billing','paid')
                        ORDER BY created_at DESC LIMIT 1
                        """,
                        tenant.id, mesa_value,
                    )
                if sess_row:
                    pc = _build_post_cuenta_block(tenant)
                    if pc:
                        system_blocks.append({"type": "text", "text": pc})
            except Exception:
                logger.exception(
                    "post_cuenta block lookup failed",
                    extra={"tenant_slug": tenant.slug, "event": "post_cuenta_lookup_error"},
                )

    # Mig 027 Fase 6: si el cliente tiene un pedido en pending_kitchen_review
    # con kitchen_decision='accepted' Y customer_eta_decision NULL, inyectamos
    # bloque <pedido_pendiente_eta> que dice al bot que el siguiente mensaje
    # del cliente probablemente sea su respuesta al ETA propuesto. El bot debe
    # llamar responder_eta_pedido con accepted=true|false según interprete.
    try:
        # Mig 029: el playground también se beneficia de este bloque — si el
        # admin acepta un pedido de prueba en KDS, la siguiente turn del playground
        # detecta el pending_eta y puede probar la tool responder_eta_pedido. La
        # query usa customer_phone="playground-sandbox" que solo matchea filas
        # is_test=true creadas desde el playground, sin colisión con clientes reales.
        if customer_phone:
            pendiente = await obtener_pedido_pendiente_eta(tenant.id, customer_phone)
            if pendiente:
                eta = pendiente.get("eta_minutes") or "?"
                tot = pendiente.get("total_eur") or 0
                bloque_eta = (
                    "<pedido_pendiente_eta>\n"
                    f"El cliente tiene un pedido aceptado por cocina esperando que él confirme el TIEMPO DE PREPARACIÓN.\n"
                    f"  - Pedido id: {pendiente['id']}\n"
                    f"  - Tiempo propuesto por cocina: {eta} minutos\n"
                    f"  - Total: {tot:.2f} {pendiente.get('currency', 'EUR')}\n"
                    f"  - Tipo: {pendiente.get('order_type', '?')}\n"
                    "Si el siguiente mensaje del cliente parece responder al tiempo "
                    "(sí/vale/ok/perfecto/me parece bien → acepta; no/mucho tiempo/cancela → rechaza), "
                    "USA la tool `responder_eta_pedido` con accepted=true|false según corresponda. "
                    "Si el mensaje es ambiguo (cliente pide otra cosa, hace pregunta nueva), "
                    "responde a esa pregunta normalmente y NO llames la tool — el contexto "
                    "se mantendrá hasta que el cliente conteste claramente.\n"
                    "</pedido_pendiente_eta>"
                )
                system_blocks.append({"type": "text", "text": bloque_eta})
    except Exception:
        logger.exception(
            "pedido_pendiente_eta block falló (flujo sigue sin el bloque)",
            extra={"tenant_slug": tenant.slug, "event": "pending_eta_block_error"},
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
                    resultado = await _ejecutar_tool(
                        tenant, block.name, block.input, customer_phone,
                        sandbox=sandbox, cards_sink=cards_sink,
                    )
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
