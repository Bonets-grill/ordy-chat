# Plan — Arquitectura multi-agente por tenant

**Fecha:** 2026-04-19
**Autor:** Claude (brief de Mario)
**Estado:** DRAFT — revisar con /autoplan antes de build

---

## Contexto

Hoy el runtime `runtime/app/brain.py` es un **monolito**: un único Claude con N tools (crear_pedido, crear_cita, crear_handoff, listar_citas). Problemas observados:
- Alucinaciones cuando el mensaje toca varias áreas (ej: "reserva + pedido para llevar" mezcla prompts).
- Prompts hinchándose con cada feature nueva → más distracción al LLM → más errores.
- Imposible auditar qué parte del agente falló cuando da respuesta mala.
- Evaluación (validador LLM-judge) es all-or-nothing — no sabemos qué módulo es el débil.

**Objetivo Mario:** "agentes que funcionen de verdad y no se equivoquen."

## Propuesta

Reemplazar el monolito por una **arquitectura multi-agente por tenant**:

```
Canal (WA / Webchat / (futuro) Voz)
     │
     ▼
CHANNEL ADAPTER ───── normaliza a formato interno (IncomingMessage)
     │
     ▼
ROUTER (Haiku 4.5, cheap, ~200ms)
     │ clasifica multi-label: intents = ["reservas", "pedidos", "info"]
     ▼
ORQUESTADOR (Sonnet 4.6, por tenant)
     │ lee intents + contexto conversación + add-ons activos del tenant
     │ decide qué agente(s) invocar, en qué orden, con qué inputs
     │ integra respuestas en UNA sola al cliente
     ▼
┌─────────────────────────────────────────────────────────────┐
│  AGENTES ESPECIALIZADOS (Haiku 4.5 salvo casos complejos)   │
├───────────┬───────────┬──────────┬──────────┬──────────────┤
│  BASE     │ RESERVAS  │ PEDIDOS  │ KDS      │ POS          │
│ (incluido)│ (add-on)  │ (add-on) │ (add-on) │ (add-on)     │
├───────────┼───────────┼──────────┼──────────┼──────────────┤
│ carta,    │ crear_cita│crear_ped│status de │emitir_recibo │
│ horarios, │ cancelar_ │ toma    │pedido    │verifactu_    │
│ FAQ,      │ cita      │ nota    │(consulta │submit        │
│ alergias, │ no_show_  │ alergias│KDS hoy)  │pdf_factura   │
│ maridajes │ prepago   │ stripe_ │          │              │
│           │           │ link    │          │              │
└───────────┴───────────┴──────────┴──────────┴──────────────┘
```

### Decisiones arquitectónicas

| # | Decisión | Rationale |
|---|---|---|
| 1 | **Router multi-label** (un msg puede disparar varios agentes) | "quiero reservar y pedir para llevar" es frecuente |
| 2 | **Orquestador con su propio LLM** que integra las N respuestas en una | Cliente recibe una sola respuesta coherente |
| 3 | **Estado conversacional único** con `slots` por add-on | Evita duplicación, cada agente lee/escribe su slot |
| 4 | **Reservas = add-on** (no base) | Coherente con pricing; tenants sin reservas no deben pagar por ello |
| 5 | **Channel-agnostic adapter** desde día 1 | Voz llega Q2, no queremos refactor |
| 6 | **Validador LLM-judge por agente** | Cada agente tiene sus seeds + rubric — localiza quién falla |
| 7 | **Nueva tabla `agent_invocations`** | Auditoría: qué agente respondió, qué tool usó, latency, coste |
| 8 | **Haiku para router + agentes; Sonnet solo orquestador** | Coste-optimizado; Sonnet cuando realmente razona sobre múltiple output |
| 9 | **Bonets Grill tenant de prueba con TODOS los add-ons ON** | Dogfood end-to-end |

### Flujo detallado — ejemplo real

Mensaje entrante WA: `"Buenas, queremos reservar mesa 4 personas mañana a las 21h, una celiaca. Y si podéis mandar carta del día."`

1. **Channel adapter** (whapi) → `IncomingMessage{tenant, from, text, channel='whatsapp'}`
2. **Router** Haiku → `{intents: ["reservas", "base"], confidence: 0.93}` (base para "carta del día")
3. **Orquestador** Sonnet carga:
   - tenant_config (add-ons activos, system_prompt base)
   - conversación memoria (últimos 20 turnos)
   - slots actuales (vacíos si es primera vez)
4. Orquestador decide plan:
   - Paso 1 agente **Reservas** con input: "reservar mañana 21h, 4 pax, 1 celíaca"
   - Paso 2 agente **Base** con input: "carta del día"
   - Paso 3 integrar respuestas (puede hacerse paralelo si son independientes)
5. **Agente Reservas** Haiku:
   - Consulta `tenantFiscalConfig.reservations_closed_for` → día no cerrado
   - Tool `crear_cita({starts_at: 2026-04-20T21:00Z, duration: 90, party: 4, notes: "celíaca"})` → `appointment_id: xyz`
   - Retorna: `"Mesa reservada mañana a las 21:00 para 4 personas, alergia celíaca anotada."`
6. **Agente Base** Haiku:
   - Prompt tenant includes current menu from `agent_configs.knowledge`
   - Retorna: `"Hoy tenemos: entrantes — tataki de atún (sin gluten), burrata. Principales — merluza al horno (sin gluten), solomillo. Postres — coulant de chocolate."`
7. **Orquestador** Sonnet integra:
   - `"Hecho ✓ Mesa para 4 mañana 21:00 con alergia celíaca anotada. Te mando recordatorio 2h antes. Carta del día: entrantes (tataki de atún sin gluten, burrata), principales (merluza al horno sin gluten, solomillo), postre (coulant). ¿Confirmas la mesa o te reservo mejor con opciones sin gluten ya pre-seleccionadas?"`
8. **Channel adapter** envía via Whapi/Meta/Twilio.
9. **Auditoría**: guarda en `agent_invocations` 3 filas (router, reservas, base) + 1 en `orchestrator_runs`.

### Qué cambia en el código

**Nuevas carpetas `runtime/app/agents/`:**
- `router.py` — clasificador Haiku multi-label
- `orchestrator.py` — integrator Sonnet
- `base.py` — agente carta/horarios/FAQ/alergias/maridajes
- `reservas.py` — agente add-on reservas
- `pedidos.py` — agente add-on pedidos
- `kds.py` — agente add-on KDS (consulta estado)
- `pos.py` — agente add-on POS/Verifactu
- `channel_adapter.py` — Protocol para WA/webchat/voz

**`runtime/app/brain.py` → refactorizado**:
- Mantiene entry point `process_message(tenant_id, incoming)`.
- Ahora delega al router → orquestador → agentes. NO borrar hasta migración probada.

**Nueva tabla `agent_invocations`** (migración 017):
```sql
CREATE TABLE agent_invocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id UUID REFERENCES messages(id),
  agent_name TEXT NOT NULL,  -- 'router' | 'orchestrator' | 'base' | 'reservas' | ...
  parent_invocation_id UUID REFERENCES agent_invocations(id),  -- para tracing
  input_text TEXT NOT NULL,
  input_context JSONB,  -- slots, intents, memoria snapshot
  output_text TEXT,
  tools_used JSONB,  -- [{name, args, result}]
  model TEXT NOT NULL,  -- 'claude-haiku-4-5-20251001'
  latency_ms INTEGER,
  tokens_input INTEGER,
  tokens_output INTEGER,
  cost_cents INTEGER,  -- estimado
  status TEXT NOT NULL,  -- 'success' | 'error' | 'timeout'
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_agent_invocations_tenant_msg ON agent_invocations (tenant_id, message_id);
CREATE INDEX idx_agent_invocations_conversation ON agent_invocations (conversation_id, created_at);
```

**Extensión `tenant_fiscal_config`** → `tenant_add_ons`:
```sql
CREATE TABLE tenant_add_ons (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  reservas_enabled BOOLEAN NOT NULL DEFAULT false,
  pedidos_enabled BOOLEAN NOT NULL DEFAULT false,
  kds_enabled BOOLEAN NOT NULL DEFAULT false,
  pos_enabled BOOLEAN NOT NULL DEFAULT false,
  webchat_enabled BOOLEAN NOT NULL DEFAULT true,  -- incluido en base
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Bootstrap: INSERT para bonets-grill-icod con TODOS en true.
```

**Validador actualizado** (`runtime/app/validator/`):
- `seeds.py` → seeds por agente + seeds cross-agent (integración)
- `judge.py` → rubric por agente específico
- `runner.py` → ejecuta cada agente independiente + escenarios end-to-end

### Estado conversacional (slots)

```python
# runtime/app/agents/state.py
class ConversationState(BaseModel):
    tenant_id: UUID
    conversation_id: UUID
    slots: dict[str, Any] = {}
    # Ejemplos:
    # slots["reservas.pending_confirmation"] = {"appointment_id": "xyz", "asked_at": "..."}
    # slots["pedidos.cart"] = [{"name": "hamburguesa", "qty": 2}]
    # slots["base.customer_name"] = "Clara"
    # slots["base.known_allergies"] = ["gluten"]
```

Cada agente recibe solo su slot (`slots["reservas.*"]`) + un summary plano del resto.

### Costes y latencia estimados

Por mensaje:
- Router Haiku: ~300 tok → ~0.02¢ → 300ms
- Orquestador Sonnet: ~2000 tok → ~2.5¢ → 2s
- 2 agentes Haiku (promedio): ~800 tok cada → 0.1¢ → 600ms × 2

**Total por mensaje**: ~3¢, ~3.5s end-to-end (aceptable para WhatsApp; demasiado para voz, donde pasamos a Haiku orquestador o agente único específico).

Caching prompt ahorra ~50% en Sonnet si el system prompt es estable — `prompts_caching` de Anthropic SDK.

### Plan de migración (fases deployables)

1. **Fase 1 (spec + schema)** — este documento aprobado, migración 017 `agent_invocations` + `tenant_add_ons` aplicada. 0 cambios runtime.
2. **Fase 2 (router + orquestador shadow)** — runtime nuevo path que ejecuta router+orquestador+agentes en paralelo al brain.py viejo, pero sigue usando output del viejo. Logs a agent_invocations. Evaluación: comparar respuestas y medir drift.
3. **Fase 3 (cutover progresivo)** — flag `multi_agent_enabled` por tenant en `tenant_add_ons`. Bonets Grill primero. Si eval pass + drift <10%, extender.
4. **Fase 4 (deprecation brain.py)** — eliminar monolito tras 2 semanas sin regresiones.
5. **Fase 5 (channel voz)** — Twilio Voice adapter pluga al channel adapter. Gating: feature flag.

### Riesgos

| Riesgo | Mitigación |
|---|---|
| Latencia 3.5s > 1s del monolito actual | Paralelizar agentes cuando son independientes + caching prompt |
| Coste 3¢/msg vs ~1¢ monolito | Aceptable dado el objetivo "no se equivoca"; Haiku baja coste |
| Agente individual alucina pese a prompt corto | Validador LLM-judge pre-deploy por agente |
| Orquestador integra mal (pierde info de un agente) | Eval específica "multi-intent messages" |
| Refactor rompe flujos WA actualmente en prod | Shadow mode Fase 2 mitiga |
| N agentes = N prompts a mantener | System prompt generado por add-on template + validador garantiza |

### Evals mandatorias (Promptfoo, antes de merge cada agente)

- **Router**: 50 mensajes con intents esperados, accuracy >90%
- **Base**: 30 FAQ del tenant de prueba (Bonets Grill) respondidas correctamente
- **Reservas**: 20 escenarios (reservar, confirmar, cancelar, día cerrado, mesa ocupada, alergia, grupo grande)
- **Pedidos**: 15 escenarios (nuevo pedido, añadir items, quitar, pago, alergias)
- **KDS**: 10 consultas status
- **POS**: 10 escenarios emisión + errores Verifactu
- **Orquestador end-to-end**: 40 mensajes multi-intent del tenant real Bonets Grill

Todas deben pasar en staging antes de cutover de un tenant.

---

## Questions abiertas para /autoplan

(Los subagents deben presionar estas)

1. ¿Channel adapter como Protocol Python o como clase base abstracta? Implicación: Protocol es más pythonic pero menos descubrible para nuevos devs.
2. ¿El orquestador puede ser determinista (workflow DAG) en vez de LLM? Ventaja: cero alucinaciones. Desventaja: falla con casos edge no anticipados.
3. ¿Cache de respuestas de agentes (mismo input → misma respuesta)? Cuidado: privacy + frescura.
4. ¿Qué hacer si un agente falla (timeout, error)? ¿Responder parcial, o pedir disculpas, o bloquear el flujo?
5. ¿Promptfoo evals se ejecutan en CI pre-merge o post-merge monitoreando drift?
6. Pricing: si mantenemos €19.90 base + add-ons €9.90, y ahora la base NO incluye reservas (add-on), ¿suben el base a €24.90 para compensar?

---

## Success criteria

El plan se considera READY cuando:
- [ ] CEO review: dream state claro + alternatives explorados + riesgo mercado mapeado
- [ ] Eng review: diagrama arquitectura + test plan + failure modes + migración shadow validada
- [ ] AI-specific review: eval plan completo + rubric por agente + fallback failures
- [ ] DX review: cómo un dev añade el agente N+1 a un tenant nuevo en <30 min

Veredicto BLOCKED si cualquiera de:
- Canibaliza features existentes sin plan de deprecación
- No tiene eval harness por agente antes de cutover
- Costes proyectados >5¢/msg sin justificación revenue
- No hay plan de rollback si shadow mode detecta drift >10%
