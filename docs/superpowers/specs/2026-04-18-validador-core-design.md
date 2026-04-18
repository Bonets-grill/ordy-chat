# Validador Core — Design Spec

**Fecha:** 2026-04-18
**Sprint:** 2 de 3 (super-admin-v2 ✅ → **validador-core** → validador-ui)
**Proyecto:** whatsapp-agentkit (Ordy Chat)
**Estado:** aprobado tras brainstorm combinado, pendiente blueprint + audit-architect

---

## 1. Objetivo

Detectar automáticamente bots mal configurados antes de que hablen con clientes reales. Tras cada onboarding, correr 20 mensajes-semilla contra el bot del tenant, puntuar respuestas con asserts deterministas + LLM judge, y — según el flag `validation_mode_default` y el `paused` existente — pausar el bot si rompe algo crítico o autopatchear el system prompt una vez.

**No-goals Sprint 2:**
- UI de review manual (Sprint 3).
- Semillas generadas dinámicamente por LLM (híbrido estático/nicho basta para v1).
- Fine-tuning del prompt más allá del autopatch de 1 intento.
- Cambio del `brain.py` del runtime (reutilización total).

**Success metric.** Tras el onboarding fast, el tenant tiene un `validator_runs` row con verdict PASS/REVIEW/FAIL. Si FAIL crítico → `tenants.paused = true` antes de que el webhook de WhatsApp reciba su primer mensaje real.

## 2. Decisiones del brainstorm combinado (ya aprobadas)

| D | Elegido | Justificación |
|---|---------|---------------|
| D1 | Soft gate: bot activo siempre; validator paralelo; pause on critical assert fail | Onboarding fast promete <2 min al QR. Bloqueo manual rompe promesa. |
| D2 | 20 semillas híbridas: 8 universales + 12 por nicho | Balance cobertura/coste sin LLM-gen dinámico. |
| D3 | Rubric: 3 asserts deterministas (FAIL crítico) + 4 dims LLM judge 0-40 | Lo determinista es objetivo; LLM mide calidad. |
| D4 | Autopatch 1 intento; si re-FAIL → email al tenant | UX + transparencia. |

## 3. Decisiones micro nuevas

### 3.1 Dónde viven las semillas

`runtime/app/validator/seeds/` con archivos JSON por nicho:

```
runtime/app/validator/seeds/
├── universal.json     # 8 mensajes (saludo, horario, precio, reserva, alérgeno,
│                      #   queja, fuera-de-horario, humano)
├── restaurante.json   # 12 mensajes
├── clinica.json       # 12 mensajes
├── hotel.json         # 12 mensajes
├── servicios.json     # 12 mensajes (fallback generic)
```

Formato por seed:
```json
{
  "id": "uni-01",
  "text": "¿A qué hora abrís hoy?",
  "expected_action": "none",       // "none" | "crear_pedido" | "agendar_cita" | "solicitar_humano"
  "expected_mentions": ["horario"],// keywords que deberían aparecer
  "locale": "es"
}
```

### 3.2 Detección de nicho

`runtime/app/validator/seeds.py::detectar_nicho(agent_config) -> str`. Regex sobre `business_description` + `categories[].name`:

```python
NICHOS = {
    "restaurante": r"\b(restaurante|bar|cafetería|bodega|menú|carta|plato|comida|cocina|pizza|sushi|tapas|hamburguesa)\b",
    "clinica":     r"\b(clínica|médico|doctor|dental|veterinaria|consulta|odontología|fisioterapia|nutrición|cita)\b",
    "hotel":       r"\b(hotel|hostal|alojamiento|habitación|hospedaje|posada|apartamento turístico|reserva)\b",
}
# Fallback: "servicios" (semillas genéricas aún distintas de universal.json).
```

Case-insensitive. Si matcha varios → el primero ganando por longitud del match (más específico). Documented en tests.

### 3.3 Cómo "enviar" mensajes sin tocar WhatsApp

El runtime invoca `brain.generar_respuesta(tenant, seed_text, [], customer_phone="+00000VALIDATOR")` directamente:
- NO pasa por providers (ni Evolution, ni Whapi, ni Meta).
- NO persiste en `messages` (tabla de prod). Persiste SOLO en `validator_messages`.
- NO cuenta en el rate limit `max_messages_per_hour` ni en el warmup (teléfono `+00000VALIDATOR` queda excluido en el warmup + rate-limit por patrón).
- Historial vacío por seed (cada seed es conversación fresca). Evaluamos respuesta aislada.

### 3.4 Judge LLM

- Modelo: `claude-haiku-4-5-20251001`. Barato + rápido.
- Tool única: `emitir_veredicto({asserts:{idioma_ok,no_filtra_prompt,no_falsa_promesa_pago}, scores:{tono,menciona_negocio,tool_correcta,no_inventa}, notas})`.
- `asserts.*` son **verificados también por Python** (asserts.py) ANTES del LLM — el LLM solo los confirma/ajusta. Son bool.
- `scores.*` son 0-10 cada uno (40 máx).

### 3.5 Autopatch

- Cuando run = FAIL y `autopatch_attempts < 1`:
  - Modelo: `claude-sonnet-4-6` (mismo que brain para consistencia).
  - Prompt: "Dado este system_prompt actual + N mensajes fallados con su razón, reescribe el system_prompt corrigiendo. NO cambies el negocio, nombre, horario. Solo refuerza reglas contra los fallos."
  - Tool: `emitir_prompt_mejorado(nuevo_prompt: str)`.
  - Aplica: `UPDATE agent_configs SET system_prompt = $1 WHERE tenant_id = $2`.
  - Incrementa `autopatch_attempts = 1`.
  - Re-ejecuta validador con los 20 seeds otra vez.
  - Si segundo run = FAIL → status='fail' final + email al tenant + admin notification.

### 3.6 Email vía Resend

- Cliente existente: `AUTH_RESEND_KEY` + `AUTH_EMAIL_FROM` ya en env.
- Helper `web/lib/email.ts::sendValidatorFailureEmail({tenantEmail, runId, reasons[]})`.
- Template HTML mínimo (bulletproof MSO-compatible como el de Auth.js).
- Endpoint interno: `POST /api/internal/validator/notify-fail` protegido con `x-internal-secret`. El runtime lo llama tras FAIL final.

### 3.7 Trigger automático

En `web/app/api/onboarding/fast/confirm/route.ts`, tras `createTenantFromCanonical` éxito:

```ts
const validationMode = await getFlag<"auto"|"manual"|"skip">("validation_mode_default");
if (validationMode !== "skip") {
  fetch(`${RUNTIME_URL}/internal/validator/run-seeds`, {
    method: "POST",
    headers: { "Content-Type":"application/json", "x-internal-secret": RUNTIME_INTERNAL_SECRET },
    body: JSON.stringify({ tenant_id: result.tenantId, triggered_by: "onboarding_auto" }),
    signal: AbortSignal.timeout(1500),
  }).catch(e => console.error("[onboarding-fast] validator trigger fail:", e));
}
```

Fire-and-forget, no bloquea el QR.

### 3.8 Exclusión del rate-limit + warmup del validator phone

El validator usa `customer_phone = "+00000VALIDATOR"` (patrón no-E164, imposible de existir). En:
- `runtime/app/outbound_throttle.py::esperar_con_warmup` — si phone startswith `+00000`, retorna `{blocked: False, waited: 0, tier: "mature"}`.
- `runtime/app/rate_limit.py::mensajes_en_ultima_hora` — excluir en la query (`AND content_hash NOT IN validator_runs`). Actually más simple: los mensajes del validator NUNCA se escriben en `messages` → no cuentan. Confirmado.

## 4. Schema DB (migración 010)

```sql
-- shared/migrations/010_validator.sql
BEGIN;

CREATE TABLE IF NOT EXISTS validator_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  triggered_by TEXT NOT NULL
    CONSTRAINT validator_runs_triggered_by_check
    CHECK (triggered_by IN ('onboarding_auto', 'admin_manual', 'autopatch_retry')),
  nicho TEXT NOT NULL,  -- 'universal_only'|'restaurante'|'clinica'|'hotel'|'servicios'
  status TEXT NOT NULL
    CONSTRAINT validator_runs_status_check
    CHECK (status IN ('running', 'pass', 'review', 'fail', 'error')),
  summary_json JSONB,
  -- {total, passed, review, failed, asserts_critical:{idioma, no_filtra, no_falsa_promesa},
  --  scores_avg:{tono, menciona, tool, no_inventa}}
  autopatch_attempts INTEGER NOT NULL DEFAULT 0,
  autopatch_applied_at TIMESTAMPTZ,
  previous_system_prompt TEXT,  -- snapshot pre-autopatch para rollback manual
  paused_by_this_run BOOLEAN NOT NULL DEFAULT false,  -- true si este run puso tenants.paused=true
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_validator_runs_tenant_recent
  ON validator_runs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_validator_runs_status_pending
  ON validator_runs(status) WHERE status IN ('running');

ALTER TABLE validator_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS validator_runs_tenant ON validator_runs;
CREATE POLICY validator_runs_tenant ON validator_runs
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);


CREATE TABLE IF NOT EXISTS validator_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES validator_runs(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  seed_id TEXT NOT NULL,                  -- "uni-01", "rest-03"
  seed_text TEXT NOT NULL,
  seed_expected_action TEXT,              -- 'none'|'crear_pedido'|etc
  response_text TEXT NOT NULL,
  tools_called JSONB,                     -- [{name, input}]
  asserts_result JSONB,                   -- {idioma_ok:bool, no_filtra_prompt:bool, no_falsa_promesa_pago:bool}
  judge_scores JSONB,                     -- {tono, menciona_negocio, tool_correcta, no_inventa}
  judge_notes TEXT,
  verdict TEXT NOT NULL
    CONSTRAINT validator_messages_verdict_check
    CHECK (verdict IN ('pass', 'review', 'fail')),
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_validator_messages_run
  ON validator_messages(run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_validator_messages_tenant
  ON validator_messages(tenant_id, created_at DESC);

ALTER TABLE validator_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS validator_messages_tenant ON validator_messages;
CREATE POLICY validator_messages_tenant ON validator_messages
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

COMMIT;
```

Rollback:
```sql
BEGIN;
DROP TABLE IF EXISTS validator_messages;
DROP TABLE IF EXISTS validator_runs;
COMMIT;
```

Zero cambios a tablas existentes.

## 5. Estructura de archivos

### Nuevos (runtime)
```
runtime/app/validator/__init__.py
runtime/app/validator/seeds.py          # detectar_nicho + cargar_seeds
runtime/app/validator/seeds/universal.json
runtime/app/validator/seeds/restaurante.json
runtime/app/validator/seeds/clinica.json
runtime/app/validator/seeds/hotel.json
runtime/app/validator/seeds/servicios.json
runtime/app/validator/asserts.py        # 3 asserts deterministas
runtime/app/validator/judge.py          # LLM judge (haiku)
runtime/app/validator/autopatch.py      # reescritor system_prompt (sonnet)
runtime/app/validator/runner.py         # orquestador principal
runtime/app/validator/persist.py        # INSERT validator_runs/_messages
runtime/tests/test_validator_seeds.py
runtime/tests/test_validator_asserts.py
runtime/tests/test_validator_detectar_nicho.py
runtime/tests/test_validator_persist.py
```

### Nuevos (web)
```
web/lib/db/schema.ts                    # MODIFICADO: añadir validatorRuns + validatorMessages
web/lib/email.ts                        # Helper Resend (con sendValidatorFailureEmail export)
web/app/api/internal/validator/notify-fail/route.ts  # POST: Resend email
web/tests/unit/validator-email.test.ts
```

### Modificados
```
runtime/app/main.py                     # añadir POST /internal/validator/run-seeds
runtime/app/outbound_throttle.py        # skip validator phone
web/app/api/onboarding/fast/confirm/route.ts  # trigger validator post-createTenant
shared/migrations/010_validator.sql (NUEVO, listado arriba)
```

## 6. API / endpoints

### Runtime

**`POST /internal/validator/run-seeds`**
- Auth: `x-internal-secret` + `hmac.compare_digest`.
- Body: `{tenant_id: UUID, triggered_by: "onboarding_auto"|"admin_manual"|"autopatch_retry"}`.
- Fire-and-forget: `asyncio.create_task(ejecutar_validator(tenant_id, triggered_by))`. Devuelve 202 inmediato con `{run_id}`.
- Proceso async:
  1. Cargar tenant via `cargar_tenant_por_slug` (vía tenant_id lookup).
  2. Detectar nicho de `agent_config.business_description + categories`.
  3. Construir 20 semillas (8 universales + 12 del nicho).
  4. INSERT `validator_runs(status='running')`.
  5. Para cada semilla: `brain.generar_respuesta` + `asserts.evaluate` + `judge.judge` + INSERT `validator_messages`.
  6. Agregar verdicts: `pass` si todos pass, `fail` si ≥1 assert crítico roto, `review` si hay borderline.
  7. Si `fail` crítico + `autopatch_attempts=0`: autopatchear + recursive call (triggered_by='autopatch_retry').
  8. Si `fail` crítico tras autopatch: `UPDATE tenants SET paused=true`, llamar web `/api/internal/validator/notify-fail`, `paused_by_this_run=true`.
  9. UPDATE `validator_runs(status, summary_json, completed_at)`.

### Web

**`POST /api/internal/validator/notify-fail`**
- Auth: `x-internal-secret` + `timingSafeEqual`.
- Body: `{run_id, tenant_id, reasons: string[]}`.
- Lee `tenants.ownerUserId` → `users.email`. Envía Resend email con summary + link al (futuro) `/admin/validator/[run_id]` (Sprint 3).

## 7. Seguridad

1. **RLS** en `validator_runs` + `validator_messages` (defense-in-depth, super admin queries con `SET app.current_tenant_id` si procede).
2. **Internal secrets timing-safe** (patrón ya establecido).
3. **Autopatch NO elimina datos del tenant** — solo reescribe `system_prompt` con snapshot `previous_system_prompt` para rollback manual.
4. **validator_messages NO expone PII real** — los `+00000VALIDATOR` phones son fijos y el texto de seeds es genérico.
5. **No prompt-injection desde seeds** — seeds son fixtures del proyecto, controlados por nosotros.
6. **Límite de runs por tenant** — rate-limit `admin_manual` triggers a 3 por hora (evita que un super admin chute 100 runs = $$ Claude).

## 8. Performance y coste

- **Por run:** 20 × (1 brain call sonnet + 1 judge call haiku) + 0-1 autopatch sonnet.
- **Tokens estimados:** ~15k sonnet + ~10k haiku + (~5k sonnet if autopatch) = $0.08-0.15 / run.
- **Tiempo:** serializable 20 × 5s = 100s es demasiado. **Paralelizar con `asyncio.gather` batches de 5.** Meta: <40s total por run.
- **Meta SLO:** 95% de runs completan <60s.

## 9. Testing

### Unit (pytest runtime)
- `test_validator_detectar_nicho.py` — matriz business_description → nicho esperado + edge cases.
- `test_validator_seeds.py` — carga JSON, valida shape.
- `test_validator_asserts.py` — 3 asserts con fixtures (idioma es/en detection, prompt leak patterns, false payment promise).
- `test_validator_persist.py` — mock asyncpg, verifica shape INSERT.

### Unit (vitest web)
- `test validator-email.test.ts` — template rendering.

### Integration (futuro — fuera scope Sprint 2)
- Correr validator contra un tenant dummy real con mocks de Anthropic → asserts end-to-end. Se cubrirá cuando Sprint 3 UI muestre los resultados y se pueda probar manual.

### Promptfoo evals del judge (Sprint 3)
Deferred: necesita UI para observar scores.

## 10. Orden de build

1. **Migración 010** aplicada + schema.ts Drizzle.
2. **seeds JSON + detectar_nicho + tests** (puro, sin DB).
3. **asserts.py + tests** (puro, regex).
4. **judge.py** (LLM haiku, mockeable).
5. **autopatch.py** (LLM sonnet, reusa `obtener_anthropic_api_key`).
6. **persist.py** (INSERT runs/messages).
7. **runner.py** (orquestador; asyncio.gather paralelo).
8. **main.py endpoint /internal/validator/run-seeds** + **outbound_throttle.py skip validator phone**.
9. **web/lib/email.ts + notify-fail route**.
10. **confirm/route.ts trigger post-tenant**.

## 11. Riesgos

| Riesgo | Mitigación |
|---|---|
| Costo Anthropic por run escala con #tenants | Rate-limit 3 runs/hora/tenant + flag `validation_mode_default=skip` kill-switch. |
| Judge LLM no-determinista puede variar verdict entre runs | temperature=0.0 + expected_action como ground truth duro. |
| Autopatch introduce regresión en `system_prompt` | Snapshot `previous_system_prompt` + endpoint admin rollback (Sprint 3). |
| paused=true bloquea tenant que era falsificado por falso positivo del judge | Sprint 3 UI permite unpause con 1 click + razón auditada. |
| Validator phone `+00000VALIDATOR` choca con número real raro | Patrón improbable; si salta, migramos a `tenant.id` como suffix. |
| asyncio.gather con 20 llamadas Anthropic satura rate limit | Batches de 5 con `asyncio.Semaphore(5)`. |

## 12. Fuera de scope explícito

- `/admin/validator` UI — Sprint 3.
- Override por tenant de `validation_mode` — Sprint 3.
- Audit log detallado de cada INSERT (usamos `validator_runs` como audit en sí mismo).
- Batch re-validation (correr todos los tenants existentes) — herramienta futura.
- Multi-idioma de seeds (v1 = español. EN/FR futuros).

## 13. Handoff

Tras aprobación:
1. `the-architect` → blueprint ejecutable en `docs/superpowers/blueprints/2026-04-18-validador-core-blueprint.md`.
2. `audit-architect` → 5 auditores paralelos → READY.
3. Aplicar fixes, ejecutar fases con commit por fase, push → auto-deploy.
