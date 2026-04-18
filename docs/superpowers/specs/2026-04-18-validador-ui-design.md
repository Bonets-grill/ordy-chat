# Validador UI — Design Spec

**Fecha:** 2026-04-18
**Sprint:** 3 de 3 (super-admin-v2 ✅ → validador-core ✅ → **validador-ui**)
**Proyecto:** whatsapp-agentkit
**Estado:** decisiones del brainstorm combinado + micros cerrados aquí, pendiente blueprint + audit

---

## 1. Objetivo

Dar al super admin pantalla para ver runs del validador, revisar respuestas del bot (modo manual), aprobar/rechazar, unpausar agentes, disparar runs manuales, y hacer rollback del autopatch. Cerrar el loop visual del validador-core.

**No-goals Sprint 3:**
- Cambios al judge LLM o rubric (Sprint 2 ya cerrado).
- Promptfoo evals del judge (v2 opcional).
- Multi-idioma UI (es only por ahora).
- Notificaciones push al admin (solo email ya existente).

**Success metric Sprint 3:** el super admin puede, desde `/admin/validator`:
1. Ver la lista de runs con filtros por status/tenant/fecha.
2. Abrir un run y ver los 20 mensajes con rubric + approve/reject por card.
3. Togglear validation_mode por tenant (auto/manual/skip/default).
4. Unpausar un agente burned por validator con 1 click.

## 2. Decisiones del brainstorm (recordatorio)

- D1 Soft gate: bot activo siempre; validador paralelo; pause on critical fail.
- D4 Autopatch 1 intento → email si re-FAIL. En modo **manual** no autopatchea.
- UI: **card-per-row scrollable** con rubric + approve/reject/edit.
- Toggle global ya en Sprint 1 (`/admin/flags` → `validation_mode_default`).
- Override por tenant: nueva columna `agent_configs.validation_mode` (NULL = usa global).

## 3. Decisiones micro nuevas

### 3.1 Modo manual — comportamiento

En modo `manual`:
- Runner ejecuta las 20 seeds como siempre.
- Asserts + judge corren como siempre.
- **NO dispara autopatch automático**. Si hay FAIL, `run.status='fail'` pero `agent_configs.paused` NO se toca automáticamente.
- El admin decide manualmente desde `/admin/validator/[run_id]` si:
  - Aprobar todo → nada cambia, agente sigue activo.
  - Rechazar → `agent_configs.paused=true` + audit.
  - Rollback autopatch previo (si aplicable, nivel Sprint 2 run previo) → restaura `previous_system_prompt`.
  - Disparar autopatch manual (1 intento, igual que en modo auto).

En modo `auto`: comportamiento actual del Sprint 2 (autopatch automático + pause si re-FAIL). Sprint 3 solo añade la UI de revisión — el flow automático sigue.

En modo `skip`: no se dispara el runner, no hay run.

### 3.2 Schema DB — migración 011

Columna nueva en `agent_configs`:
```sql
ALTER TABLE agent_configs
  ADD COLUMN IF NOT EXISTS validation_mode TEXT
    CHECK (validation_mode IS NULL OR validation_mode IN ('auto','manual','skip'));
```

NULL = sigue la global (`validation_mode_default` del flag Sprint 1). No-NULL = override del tenant específico.

Helper resolución (runtime + web):
```
efectivo = tenant.agent_config.validation_mode ?? getFlag('validation_mode_default')
```

### 3.3 Modificación al runner Sprint 2 (F6 de este sprint)

`runtime/app/validator/runner.py::ejecutar_validator` debe:
1. Resolver `validation_mode` efectivo (override > flag > default 'skip').
2. Si `skip` → early return sin crear run.
3. Si `manual` → saltar el bloque de autopatch recursive; NO llamar `marcar_agente_pausado`. Solo `cerrar_run(status='review' if fail else status_actual)`.
4. Si `auto` → comportamiento actual sin cambios.

### 3.4 UI — `/admin/validator`

Tabla lista con columnas:
- Tenant (slug + name)
- Triggered by
- Status badge (running/pass/review/fail/error)
- Verdicts summary (20 ✓ / 2 ? / 1 ✗)
- Creado (relative)
- Autopatch applied?
- Paused by this run?
- Acciones: [ver detalle]

Filtros: status, tenant (search), rango fecha (24h/7d/30d/all).

### 3.5 UI — `/admin/validator/[run_id]`

Layout:
- **Header sticky**: tenant info + run summary + botones globales:
  - "Aprobar todos" (solo si status='review' + algún verdict borderline)
  - "Rechazar run" (pause agent + audit)
  - "Rollback autopatch" (solo si autopatch_applied_at existe)
  - "Disparar autopatch manual" (solo si status='fail' y autopatch_attempts=0)
  - "Unpausar agente" (solo si agent.paused=true)
- **Cards per row**: 20 cards verticales, una por seed:
  - Seed text + badge expected_action.
  - Response text.
  - Asserts badges (✓ verde / ✗ rojo).
  - Judge scores progress bars 4 dims.
  - Verdict badge.
  - Notes del judge.
  - [solo manual] Botones: Approve / Reject / Edit response (persist en nuevo campo `validator_messages.admin_decision`).

### 3.6 Nueva columna `validator_messages.admin_decision`

```sql
ALTER TABLE validator_messages
  ADD COLUMN IF NOT EXISTS admin_decision TEXT
    CHECK (admin_decision IS NULL OR admin_decision IN ('approved','rejected','edited')),
  ADD COLUMN IF NOT EXISTS admin_decided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS admin_decided_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS admin_edited_response TEXT;
```

### 3.7 Server actions

```ts
// approve/reject por mensaje individual
approveMessage(runId, messageId): Promise<Result>
rejectMessage(runId, messageId, reason?: string): Promise<Result>
editMessageResponse(runId, messageId, newResponse: string): Promise<Result>

// a nivel run
approveRun(runId): Promise<Result>          // marca todos messages no-decided como approved
rejectRun(runId, reason: string): Promise<Result>  // marca agente paused + audit
triggerManualAutopatch(runId): Promise<Result>  // fetch al runtime
rollbackAutopatch(runId): Promise<Result>   // restaura previous_system_prompt

// a nivel tenant
setValidationMode(tenantId, mode: 'auto'|'manual'|'skip'|null): Promise<Result>
unpauseAgent(tenantId): Promise<Result>     // UPDATE paused=false + audit
triggerManualRun(tenantId): Promise<Result>  // POST runtime con admin_manual
```

### 3.8 Sección en `/admin/tenants/[id]`

Si ya existe la página: añadir card "Validator" con:
- Modo actual (override o default global).
- Select para cambiar modo (auto/manual/skip/seguir default).
- Botón "Disparar run ahora" (respeta rate-limit 3/h).
- Enlace a runs previos del tenant.

Si no existe la página `[id]` detallada: crearla mínima con este card + info básica tenant.

## 4. Schema DB (migración 011)

```sql
-- shared/migrations/011_validator_ui.sql
BEGIN;

ALTER TABLE agent_configs
  ADD COLUMN IF NOT EXISTS validation_mode TEXT
    CONSTRAINT agent_configs_validation_mode_check
    CHECK (validation_mode IS NULL OR validation_mode IN ('auto','manual','skip'));

ALTER TABLE validator_messages
  ADD COLUMN IF NOT EXISTS admin_decision TEXT
    CONSTRAINT validator_messages_admin_decision_check
    CHECK (admin_decision IS NULL OR admin_decision IN ('approved','rejected','edited')),
  ADD COLUMN IF NOT EXISTS admin_decided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS admin_decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS admin_edited_response TEXT;

COMMIT;
```

Rollback:
```sql
BEGIN;
ALTER TABLE validator_messages
  DROP COLUMN IF EXISTS admin_edited_response,
  DROP COLUMN IF EXISTS admin_decided_by,
  DROP COLUMN IF EXISTS admin_decided_at,
  DROP COLUMN IF EXISTS admin_decision;
ALTER TABLE agent_configs DROP COLUMN IF EXISTS validation_mode;
COMMIT;
```

## 5. Archivos

### Nuevos
```
shared/migrations/011_validator_ui.sql
shared/migrations/011_validator_ui.rollback.sql
web/lib/admin/validator-queries.ts          # getRuns, getRunDetail, getMessagesOfRun
web/app/admin/validator/page.tsx            # lista
web/app/admin/validator/filters.tsx         # client
web/app/admin/validator/[run_id]/page.tsx   # detalle
web/app/admin/validator/[run_id]/run-actions.tsx     # client header acciones
web/app/admin/validator/[run_id]/message-card.tsx    # client card per message
web/app/admin/validator/[run_id]/actions.ts          # server actions run/message
web/app/admin/tenants/[id]/page.tsx         # (crear si no existe; o sección)
web/app/admin/tenants/[id]/validator-card.tsx
web/app/admin/tenants/[id]/actions.ts                # setValidationMode, unpause, trigger
web/tests/unit/admin/validator-queries.test.ts
web/e2e/08-validator-ui.spec.ts
```

### Modificados
```
web/lib/db/schema.ts                        # add validation_mode + admin_* a agentConfigs, validatorMessages
runtime/app/validator/runner.py             # respetar validation_mode efectivo (skip/manual/auto)
web/app/admin/page.tsx                      # add KPI "runs 24h" + link a /admin/validator
```

## 6. Seguridad

1. **`requireSuperAdmin()`** primera línea de cada action + page.
2. **Zod UUID** en todos los ids.
3. **Audit log** obligatorio por cada acción (approve_run, reject_run, unpause, trigger_manual, rollback_autopatch, set_validation_mode, approve_message, reject_message).
4. **Rate-limit trigger_manual** en web: 3/hora/tenant (mismo pattern del runtime Sprint 2 pero validado aquí antes de hacer POST al runtime).
5. **Rollback autopatch**: transacción atómica — UPDATE agent_configs.system_prompt = run.previous_system_prompt + audit. Solo si `run.previous_system_prompt IS NOT NULL`.
6. **edit_message_response** NO toca el bot real — solo registra en `admin_edited_response` para trazabilidad. El bot sigue con su respuesta original.

## 7. Orden de build

1. **Migración 011** + schema Drizzle.
2. **validator-queries.ts** + test.
3. **Server actions** nivel message (approve/reject/edit).
4. **Server actions** nivel run (approveRun, rejectRun, triggerManualAutopatch, rollbackAutopatch).
5. **Server actions** nivel tenant (setValidationMode, unpauseAgent, triggerManualRun).
6. **Modificar runner.py** para respetar validation_mode efectivo.
7. **`/admin/validator` lista + filtros**.
8. **`/admin/validator/[run_id]` detalle + cards**.
9. **`/admin/tenants/[id]/page.tsx` + validator-card**.
10. **Enriquecer `/admin` con KPI runs 24h + link**.
11. **E2E smoke + push**.

## 8. Riesgos

| Riesgo | Mitigación |
|---|---|
| Modificación a runner.py del Sprint 2 rompe funcionalidad existente | Check añadido al INICIO de ejecutar_validator; si no hay override ni flag cambia, comportamiento idéntico |
| rollback_autopatch sobrescribe un prompt más reciente (editado manual) | Audit log del autopatch anterior guarda timestamp; alert si hay UPDATE agent_configs.system_prompt posterior al previous_system_prompt — requiere confirmación admin. Documentar |
| Un admin spamea triggerManualRun | Rate-limit 3/h reusa pattern Sprint 2 |
| Edit de response LLM podría invalidar judge_scores | Es solo registro — no re-ejecuta judge. Documentado en UI |
| Tabla `/admin/validator` con >10k runs escala mal | Pagination 50 + índice tenant+created_at existente (010) |
| validation_mode=skip se activa mientras hay runs 'running' activos | Los runs ya lanzados terminan normal; solo afecta nuevas ejecuciones |

## 9. Fuera de scope explícito

- Re-ejecutar judge tras edit manual.
- Comparar respuestas pre/post autopatch (diff visual).
- Analytics histórico de success rate por nicho.
- Bulk operations (approve 100 runs con 1 click).

## 10. Handoff

Tras aprobación:
1. `the-architect` → blueprint ejecutable.
2. `audit-architect` → 5 auditores paralelos.
3. Aplicar fixes, ejecutar 11 fases.
