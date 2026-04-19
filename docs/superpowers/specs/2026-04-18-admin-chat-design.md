# Admin Chat — Chat de voz/texto del tenant con su agente

**Fecha:** 2026-04-18
**Sprint:** 6 (propuesto)
**Dependencias:** Sprint 4 (PWA) ✅ · Reseller panel merged ✅ · Migración 015 `reservations_closed_for` (renumerada desde 013: 013=password_login, 014=tenant_timezone ya consumidas)
**Scope:** permitir que el dueño del tenant chatee (texto o audio) con "su agente" para darle instrucciones tipo "cierra reservas de hoy", "quita el plato X", "pausa 2 horas", y que el agente las ejecute en su propia config — todo desde la PWA móvil con feel nativo.

---

## §1 Motivación

Hoy el tenant edita su agente desde formularios (`/agent`, `/agent/knowledge`). Flujos como "cierra reservas de hoy" requieren:
1. Ir al dashboard
2. Encontrar el campo correcto
3. Editar
4. Guardar

Experiencia real del dueño: está ocupado en la cocina, no puede pararse a usar UI. Quiere decir "**Oye Ana, cerrad reservas para hoy**" por voz y que pase.

Meta del sprint:
- PWA con chat estilo iMessage.
- Input por texto o audio.
- El bot entiende y ejecuta comandos sobre su propio config.
- Confirma acciones destructivas antes de aplicarlas.
- Todo queda en `audit_log`.

Fuera de scope:
- Chat multi-tenant (cada tenant solo habla con SU agente).
- Acciones que afectan datos de clientes (borrar conversations, etc.).
- Integración con WhatsApp del propio tenant (eso sería un bot para empleados; v2).

---

## §2 Stack

| Capa | Elección | Coste estimado |
|---|---|---|
| Frontend | Next.js 16 + PWA (ya existente) | 0 |
| STT | **Groq Whisper Large v3 Turbo** (`whisper-large-v3-turbo`) | $0.04/h → <$0.001 por comando de 10s |
| LLM orquestador | **Claude Haiku 4.5** (`claude-haiku-4-5-20251001`) con tool use | ~$0.0015 por comando (500 tok in / 200 tok out) |
| Audio grabación | `MediaRecorder` nativa + fallback MIME | 0 |
| Upload | `multipart/form-data` a `/api/agent/command/audio` | 0 |
| Auth | Auth.js sesión actual (cookie JWT) | 0 |

**Nuevas deps npm:** ninguna. Todo nativo + llamadas HTTP a Groq/Anthropic.

**Nuevas env vars:**
- `GROQ_API_KEY` (reusamos la de otros proyectos o una nueva — se pide via `/admin/settings`).

---

## §3 Arquitectura

```
┌──────── PWA /agent/chat ───────────┐
│  ChatView: mensajes, mic button,   │
│  input texto, haptics on send.     │
│  AudioRecorder: MediaRecorder       │
│    fallback audio/mp4 → webm/opus   │
│  ScrollToBottom + optimistic UI.   │
└──────────────┬─────────────────────┘
               │
       POST /api/agent/command (texto)
       POST /api/agent/command/audio (mp3|mp4|webm)
               │
               ▼
┌──────── Next.js Route handler ─────┐
│  1. requireTenant() (auth + slug)  │
│  2. rate-limit 30 cmd/h/tenant     │
│  3. audio? → Groq Whisper → texto  │
│  4. Claude Haiku con 12 tools      │
│     tool_choice: "auto"            │
│  5. tool_use → validar + ejecutar  │
│     mutación en DB (scope tenantId)│
│  6. tool_result → Claude redacta    │
│     respuesta natural              │
│  7. INSERT audit_log               │
│  8. Devuelve {reply, applied:[…]}  │
└────────────────────────────────────┘
```

### Lista de tools (12)

1. `pause_agent(duration_min?: number)` — pausa el bot X min o indefinido.
2. `unpause_agent()` — lo vuelve a activar.
3. `close_reservations_for_date(date: YYYY-MM-DD)` — añade fecha a `reservations_closed_for` (migración 013).
4. `open_reservations_for_date(date: YYYY-MM-DD)` — la quita.
5. `list_closed_reservation_dates()` — devuelve las fechas cerradas.
6. `remove_menu_item(name: string)` — **destructiva** → pide confirm vía `needs_confirm:true`.
7. `add_menu_item(name, price_eur, description?)` — append al knowledge item de menú.
8. `update_hours(text: string)` — actualiza `agent_configs.schedule`.
9. `set_fallback_message(text: string)` — actualiza `fallback_message`.
10. `append_knowledge_note(text: string)` — añade un item al array `knowledge`.
11. `get_today_stats()` — conversaciones + mensajes + pedidos de hoy.
12. `set_tone(tone: "friendly"|"professional"|"casual"|"serious")` — setea `agent_configs.tone`.

Cada tool tiene un `description` claro y `input_schema` estricto con Zod. Las destructivas devuelven `{ok:false, needs_confirm:true, preview:"Vas a quitar 'Kansas Burger'. ¿Confirmo?"}`. El LLM en la siguiente iteración pide confirmación al usuario; si dice "sí" → tool con `confirm:true`.

### Confirmation flow (tools destructivas)

```
user: "quita la kansas burger"
→ Claude llama remove_menu_item({name:"Kansas Burger"})
→ tool responde {ok:false, needs_confirm:true, preview:"Quitar 'Kansas Burger' (13,90€) del menú"}
→ Claude responde: "Vas a quitar 'Kansas Burger' (13,90€). ¿Confirmo?"
user: "sí"
→ Claude llama remove_menu_item({name:"Kansas Burger", confirm:true})
→ tool ejecuta el write + audit_log
→ Claude responde: "Hecho, Kansas Burger fuera del menú ✅"
```

### Audit log

Cada comando genera 1-N filas:
- `action='agent_chat_command'`, metadata={source:'text'|'audio', original_text, transcript?, applied_tools:[{name,input,result}]}
- `entity='agent_configs'`, `entity_id=tenant_id`

---

## §4 DB

**No añade tablas.** Usa:
- `agent_configs.reservations_closed_for` (migración 015 — la crea el spec closed-days, dependency de F1 aquí)
- `agent_configs.paused` (ya existe)
- `agent_configs.knowledge` (ya existe, JSONB)
- `agent_configs.schedule` / `tone` / `fallback_message` (ya existen)
- `audit_log` (ya existe)

---

## §5 API

### `POST /api/agent/command` (texto)

```ts
Request: { text: string }  // max 2000 chars
Response: {
  reply: string,        // respuesta natural del agente
  applied: Array<{name: string, input: object, result: object}>,
  needs_confirm?: { tool: string, input: object, preview: string },
  timestamp: string
}
```

### `POST /api/agent/command/audio` (multipart)

```
Content-Type: multipart/form-data
field: audio (File, max 2MB, <=60s)
Response: same shape as /command + {transcript: string}
```

### `GET /api/agent/command/history` (paginated)

Últimos 50 comandos del tenant + sus transcripciones + resultados.

---

## §6 Seguridad

1. **Scope tenant estricto:** todas las tools reciben `tenantId` server-side del session, NUNCA del request.
2. **Rate-limit:** 30 comandos/h/tenant vía Upstash (helper `limitByTenantAdminChat`).
3. **Cost cap:** flag global `admin_chat_cost_cap_usd_month` en platform_settings. Si tenant supera → 429.
4. **Whisper size cap:** audio ≤2MB, ≤60s. MediaRecorder lo corta si excede.
5. **Prompt injection:** el texto del usuario NO se inyecta en el system prompt del LLM del tenant que habla con clientes — este es un flujo aparte, aislado.
6. **Confirm destructive:** removes + clears siempre `needs_confirm`.
7. **Audit completo:** cada comando deja huella con input, tools, resultado.

---

## §7 UX (detalles)

- **PWA instalada:** safe-area-top + bottom. Chat ocupa toda la pantalla. Scroll inercial iOS nativo.
- **Mic button:** hold-to-record (tipo WhatsApp). Al soltar → sube. Haptics: light al empezar, medium al soltar, success al recibir respuesta.
- **Transcripción visible:** antes de procesar, muestra el transcript en pantalla "gris pendiente" → al confirmar se añade como mensaje user.
- **Optimistic UI:** el mensaje aparece instantáneo; la respuesta del agente llega después con typing indicator.
- **Historial persistente:** primeros 50 comandos via `GET /history`, scroll-up carga más.
- **Confirmación:** botones inline "Sí, confirmar" / "Cancelar".

---

## §8 Fases (8 fases)

1. **F1** — Migración 015 (heredada de spec "closed days"). Schema.ts + reservations_closed_for. Si closed-days se ejecuta primero (recomendado), esta fase se salta.
2. **F2** — Groq client + Whisper helper (`lib/speech/transcribe.ts`). Env var setup.
3. **F3** — Tool definitions (12 tools Zod schemas) + ejecutor (`lib/agent-chat/tools.ts`).
4. **F4** — Claude Haiku orchestrator (`lib/agent-chat/orchestrator.ts`) con tool_use loop + rate-limit.
5. **F5** — `/api/agent/command` + `/api/agent/command/audio` + `/api/agent/command/history`.
6. **F6** — UI `/agent/chat/page.tsx` + `ChatInterface.tsx` client + `AudioRecorder.tsx`.
7. **F7** — Audit log + history UI + confirm buttons.
8. **F8** — E2E smoke + rate-limit tests + cost cap test.

Estimado: 6-8h de trabajo real.

---

## §9 Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| iOS Safari bloquea MediaRecorder en PWA standalone | HIGH | Fallback: detectar y mostrar solo input texto. Docs dicen que 2026 iOS 17+ lo soporta en PWA, pero tester real requerido. |
| Claude Haiku interpreta mal un comando ambiguo | MEDIUM | tool_use examples + "si dudas, pregunta antes de actuar" en system prompt. |
| Tool destructiva ejecutada sin confirm | CRITICAL | Guard en tool impl: lanza si `confirm !== true` para las 2 destructivas. |
| Usuario sube audio >60s o >2MB | LOW | MediaRecorder client-side corta. Server rechaza con 413. |
| Groq API down | LOW | Fallback error "no pude entender tu audio, escríbelo por favor". |
| Cost runaway | MEDIUM | flag global $5/mes/tenant. 429 con ETA de reset. |
| Migración 015 (closed_for) no aplicada aún | BLOCKING F1 | Ejecutar spec closed-days antes de Admin Chat. |

---

## §10 Métricas éxito

- **Latencia:** <3s p95 de voz → respuesta (grabación 5s + upload + Whisper 50ms + Claude 2s + DB 100ms).
- **Coste:** <$0.002 por comando promedio.
- **Precisión tool selection:** >95% en tests de 30 comandos típicos.
- **Adopción:** si 3 de los 5 primeros tenants reales lo usan >1x/día al mes, validado.

---

## §11 Compromiso de ejecución

- NO tocar hasta que:
  1. Reseller-panel merge en main. ✅ (commit `3560259`)
  2. Closed-days spec ejecutado (migración 015 aplicada + schema.ts).
  3. Mario autorice explícitamente.
- the-architect → blueprint detallado con contratos TS completos
- audit-architect (5 auditores paralelos)
- Fases commit-push incremental
