# Validador UI — Blueprint Ejecutable (Sprint 3 / 3)

> **Generated:** 2026-04-18 · **Archetype:** Feature UI admin en SaaS existente
> **Proyecto:** `/Users/lifeonmotus/Projects/whatsapp-agentkit`
> **Spec fuente:** `docs/superpowers/specs/2026-04-18-validador-ui-design.md`
> **Idioma:** español
> **Cambios DB:** migración 011 (aditiva: `agent_configs.validation_mode` + 4 cols en `validator_messages`)

> ⚠️ **Fast-track.** Decisiones cerradas en brainstorm combinado del 2026-04-18. Este blueprint salta entrevista.

---

## 1. Objetivo Sprint 3

Cerrar el loop visual del validador: super admin ve runs, revisa respuestas, aprueba/rechaza, hace rollback de autopatch y controla modo de validación por tenant. Modificación mínima al runner Sprint 2 para respetar `validation_mode` efectivo (override por tenant > global flag).

**Success metric Sprint 3:**
- `/admin/validator` lista runs con filtros.
- `/admin/validator/[run_id]` muestra 20 cards con rubric + acciones.
- `/admin/tenants/[id]` tiene card "Validator" con toggle + trigger manual.
- runner respeta `effective_mode`: skip/manual/auto.

---

## 2. Stack + patrones ya fijados

| Capa | Usar | Fuente |
|---|---|---|
| Auth gate | `requireSuperAdmin()` + `adminAction` wrapper | `web/lib/admin/auth.ts` (Sprint 1) |
| Feature flag | `getFlag<'auto'|'manual'|'skip'>('validation_mode_default')` | `web/lib/admin/flags.ts` |
| Cifrado | `cifrar/descifrar` AES-256-GCM | `web/lib/crypto.ts` |
| RLS helper SQL | `current_tenant_id()` | `shared/migrations/005_rls_policies.sql` |
| UI shell | `<AppShell session={...}>` | `web/components/app-shell.tsx` |
| shadcn | `badge`, `button`, `card`, `input`, `label`, `textarea` | ya instalados |
| Forms | `"use client"` + Server Action via `action={fn}` | patrón existente |
| Runtime trigger | POST `/internal/validator/run-seeds` con `x-internal-secret` | Sprint 2 F8 |
| Audit log | `INSERT audit_log(userId, action, entity, entityId, metadata)` | patrón |

**Deps nuevas:** cero.

---

## 3. Inventario total

### Nuevos

| Archivo | Fase |
|---|---|
| `shared/migrations/011_validator_ui.sql` | F1 |
| `shared/migrations/011_validator_ui.rollback.sql` | F1 |
| `web/lib/admin/validator-queries.ts` | F2 |
| `web/tests/unit/admin/validator-queries.test.ts` | F2 |
| `web/app/admin/validator/[run_id]/actions.ts` (message + run actions) | F3+F4 |
| `web/app/admin/tenants/[id]/actions.ts` (tenant actions) | F5 |
| `web/app/admin/validator/page.tsx` | F7 |
| `web/app/admin/validator/filters.tsx` | F7 |
| `web/app/admin/validator/[run_id]/page.tsx` | F8 |
| `web/app/admin/validator/[run_id]/run-actions.tsx` | F8 |
| `web/app/admin/validator/[run_id]/message-card.tsx` | F8 |
| `web/app/admin/tenants/[id]/page.tsx` | F9 |
| `web/app/admin/tenants/[id]/validator-card.tsx` | F9 |
| `web/e2e/08-validator-ui.spec.ts` | F11 |

### Modificados

| Archivo | Fase | Cambio |
|---|---|---|
| `web/lib/db/schema.ts` | F1 | add `validationMode` a agentConfigs + 4 cols admin_* a validatorMessages |
| `runtime/app/validator/runner.py` | F6 | resolución `effective_mode` + branching skip/manual/auto |
| `web/app/admin/page.tsx` | F10 | add KPI "runs 24h" + link a /admin/validator |

---

## 4. Contratos TypeScript + Python

### 4.1 `web/lib/admin/validator-queries.ts`

```ts
export type ValidatorRunListItem = {
  id: string;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  triggeredBy: 'onboarding_auto' | 'admin_manual' | 'autopatch_retry';
  nicho: string;
  status: 'running' | 'pass' | 'review' | 'fail' | 'error';
  summary: { total: number; passed: number; review: number; failed: number } | null;
  autopatchAttempts: number;
  autopatchAppliedAt: Date | null;
  pausedByThisRun: boolean;
  createdAt: Date;
  completedAt: Date | null;
};

export async function getRuns(opts: {
  statusFilter?: ValidatorRunListItem['status'];
  tenantSearch?: string;
  sinceHours?: 24 | 168 | 720;
  limit?: number;
  offset?: number;
}): Promise<ValidatorRunListItem[]>;

export type ValidatorRunDetail = ValidatorRunListItem & {
  summaryJson: unknown;
  previousSystemPrompt: string | null;
};

export async function getRunDetail(runId: string): Promise<ValidatorRunDetail | null>;

export type ValidatorMessageRow = {
  id: string;
  seedId: string;
  seedText: string;
  seedExpectedAction: string | null;
  responseText: string;
  toolsCalled: unknown;
  assertsResult: {
    idioma_ok: boolean;
    no_filtra_prompt: boolean;
    no_falsa_promesa_pago: boolean;
  } | null;
  judgeScores: {
    tono: number;
    menciona_negocio: number;
    tool_correcta: number;
    no_inventa: number;
  } | null;
  judgeNotes: string | null;
  verdict: 'pass' | 'review' | 'fail';
  adminDecision: 'approved' | 'rejected' | 'edited' | null;
  adminDecidedAt: Date | null;
  adminDecidedBy: string | null;
  adminEditedResponse: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  durationMs: number | null;
  createdAt: Date;
};

export async function getMessagesOfRun(runId: string): Promise<ValidatorMessageRow[]>;

export async function getRunsKpi24h(): Promise<{
  total: number;
  byStatus: Record<ValidatorRunListItem['status'], number>;
}>;
```

### 4.2 Server actions

```ts
// web/app/admin/validator/[run_id]/actions.ts
"use server";
export async function approveMessageAction(runId: string, messageId: string): Promise<...>;
export async function rejectMessageAction(runId: string, messageId: string, reason?: string): Promise<...>;
/**
 * newResponse validado con Zod: z.string().min(1).max(4000).trim().
 * NO re-ejecuta judge (spec §9 + regla 9). Se guarda en
 * validator_messages.admin_edited_response + admin_decision='edited'
 * + admin_decided_at/by. El bot del tenant NO se toca (el system_prompt
 * sigue igual; esto es solo registro de la corrección humana del admin).
 */
export async function editMessageResponseAction(runId: string, messageId: string, newResponse: string): Promise<...>;

/**
 * Aprueba el run marcando todos los messages sin decisión como approved.
 * GUARD de unpause: el agente SOLO se unpausa si:
 *   (a) TODOS los validator_messages tienen admin_decision ∈ {'approved','edited'}
 *       (ningún 'rejected' y ningún NULL pendiente)
 *   (b) AND run.status ∈ {'pass','review'}  (nunca desde 'fail')
 * Si alguno de los dos no se cumple, approveRun marca los messages pero NO
 * cambia agent_configs.paused.
 */
export async function approveRunAction(runId: string): Promise<...>;

export async function rejectRunAction(runId: string, reason: string): Promise<...>;
/**
 * Dispara autopatch manual via runtime POST /internal/validator/run-seeds
 * con triggered_by='admin_manual'. Pasa por rate-limit del runtime (3/h).
 * Usa x-internal-secret del env + validación timingSafeEqual del runtime
 * (patrón heredado Sprint 2 F8 `_check_internal_secret`).
 */
export async function triggerManualAutopatchAction(runId: string): Promise<...>;

/**
 * Rollback del autopatch. Envuelto en db.transaction(async (tx) => {...}):
 *   1. SELECT validator_runs.previous_system_prompt WHERE id=$1.
 *   2. Si NULL → return error.
 *   3. UPDATE agent_configs SET system_prompt=$previous WHERE tenant_id=$run.tenant_id.
 *   4. INSERT audit_log action='admin_validator_autopatch_rollback'.
 *   5. Commit.
 */
export async function rollbackAutopatchAction(runId: string): Promise<...>;
```

```ts
// web/app/admin/tenants/[id]/actions.ts
"use server";
export async function setValidationModeAction(
  tenantId: string,
  mode: 'auto' | 'manual' | 'skip' | null,  // null = seguir default global
): Promise<...>;

export async function unpauseAgentAction(tenantId: string): Promise<...>;

export async function triggerManualRunAction(tenantId: string): Promise<...>;
// Internamente: await limitByTenantValidatorManual(tenantId) → 429 si ≥3/h.
// Si OK → fetch runtime /internal/validator/run-seeds con x-internal-secret
// (timingSafeEqual verificado en el runtime Sprint 2 F8).
```

### 4.2b Nueva función en `web/lib/rate-limit.ts` (MODIFICADO)

```ts
// Añadir al archivo existente (no-op si Upstash no configurado, patrón existente):
export async function limitByTenantValidatorManual(
  tenantId: string,
): Promise<{ ok: true } | { ok: false; reset: number }> {
  // 3 runs manuales por hora por tenant. Defensa en profundidad: el runtime
  // Sprint 2 F8 ya rechaza 429, pero evitamos el round-trip inútil.
  const rl = limiter("validator-manual", 3, "1 h");
  if (!rl) return { ok: true };  // no-op sin Upstash
  const r = await rl.limit(tenantId);
  return r.success ? { ok: true } : { ok: false, reset: r.reset };
}
```

Cada action:
1. `requireSuperAdmin()` primera línea.
2. Zod UUID y enum.
3. Ejecuta mutación en transacción.
4. INSERT `auditLog` con `action='admin_validator_<verb>'`.
5. `revalidatePath` de las páginas afectadas.

### 4.3 Componentes client

```ts
// web/app/admin/validator/[run_id]/run-actions.tsx
export function RunActionsHeader({ run }: { run: ValidatorRunDetail }): JSX.Element;
// botones: Aprobar todos | Rechazar run | Rollback autopatch | Disparar autopatch | Unpausar agente

// web/app/admin/validator/[run_id]/message-card.tsx
export function MessageCard({
  message,
  canDecide,
}: {
  message: ValidatorMessageRow;
  /**
   * Regla de producto (clarificada tras audit):
   *   canDecide = (run.effectiveMode === 'manual') && (message.adminDecision === null)
   * Solo en modo manual Y solo si el mensaje NO tiene decisión previa.
   * Modo 'auto' y 'skip' → canDecide siempre false (display-only).
   * Mensajes ya decided → canDecide false (no re-decisión).
   */
  canDecide: boolean;
}): JSX.Element;
// asserts badges + judge scores bars + verdict + notes + botones [solo si canDecide]
```

### 4.4 Runner diff (F6)

```python
# runtime/app/validator/runner.py — cambio QUIRÚRGICO al inicio de ejecutar_validator.

async def _resolver_validation_mode(tenant_id: UUID) -> Literal["auto", "manual", "skip"]:
    """Override por tenant > flag global > default 'skip'."""
    pool = await inicializar_pool()
    async with pool.acquire() as conn:
        override = await conn.fetchval(
            "SELECT validation_mode FROM agent_configs WHERE tenant_id = $1",
            tenant_id,
        )
    if override in ("auto", "manual", "skip"):
        return override  # type: ignore[return-value]

    # Fallback: leer global flag desde platform_settings.
    async with pool.acquire() as conn:
        raw = await conn.fetchval(
            "SELECT value_encrypted FROM platform_settings WHERE key = 'flag.validation_mode_default'",
        )
    if raw:
        from app.crypto import descifrar  # import diferido
        try:
            import json
            parsed = json.loads(descifrar(raw))
            if parsed in ("auto", "manual", "skip"):
                return parsed  # type: ignore[return-value]
        except Exception:
            pass
    return "skip"


# En ejecutar_validator, como PRIMER paso tras resolver tenant:
#   1. effective_mode = await _resolver_validation_mode(tenant_id)
#   2. if effective_mode == "skip" and triggered_by != "admin_manual": return None
#      (admin_manual siempre corre por decisión humana explícita)
#   3. Continuar con seeds + asserts + judge + persist
#   4. Modificar step 6 autopatch: solo si effective_mode == "auto"
#      Y triggered_by != "autopatch_retry"
#   5. GATE EXPLÍCITO pre-pause:
#      if effective_mode == "manual" and status == "fail":
#          status = "review"  # NO pause, NO notify-fail, NO autopatch
#      elif effective_mode == "manual" and status != "fail":
#          status se mantiene ("pass" o "review" originales)
#   6. Solo DESPUÉS del gate, si status == "fail" y triggered_by == "autopatch_retry":
#      marcar_agente_pausado + notify-fail (bloque actual Sprint 2 L378, intacto).
#      El gate garantiza que manual nunca entra a este bloque.
```

---

## 5. Schema DB (migración 011)

```sql
-- shared/migrations/011_validator_ui.sql
-- 2026-04-18 · Sprint 3 validador-ui
BEGIN;

ALTER TABLE agent_configs
  ADD COLUMN IF NOT EXISTS validation_mode TEXT
    CONSTRAINT agent_configs_validation_mode_check
    CHECK (validation_mode IS NULL OR validation_mode IN ('auto', 'manual', 'skip'));

ALTER TABLE validator_messages
  ADD COLUMN IF NOT EXISTS admin_decision TEXT
    CONSTRAINT validator_messages_admin_decision_check
    CHECK (admin_decision IS NULL OR admin_decision IN ('approved', 'rejected', 'edited')),
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

---

## 5bis. Dependencias entre fases (DAG explícito)

```
F1 (migración 011 + Drizzle) ─┬─► F2 (queries — usa cols nuevas)
                              │
                              └─► F6 (runner — lee agent_configs.validation_mode)

F2 ──► F3 (message actions — lee queries)
F2 ──► F4 (run actions — append al MISMO actions.ts de F3)
F2 ──► F5 (tenant actions — usa queries + nuevo limitByTenantValidatorManual)

F3, F4 ──► F8 (detalle usa ambas)
F5 ──► F9 (tenant page usa setValidationMode + trigger)
F2 ──► F7 (lista)
F2 ──► F10 (KPI)

F7, F8, F9, F10 ──► F11 (E2E smoke cubre los 4 paths)
```

**Reglas de paralelismo:**
- F1 es pre-req absoluto. Todo lo demás espera.
- F2 es pre-req de F3-F10.
- F3 y F4 **comparten `actions.ts`**: F4 hace **APPEND** al archivo creado en F3, NO sobrescribir exports de F3.
- F6 runner es independiente de F2-F5 (solo toca runtime Python + lee DB de F1).
- F11 E2E requiere F7-F10 mergeados.

---

## 6. Build order — 11 fases

### Fase 1 — Migración 011 + schema Drizzle
```yaml
phase_contract:
  id: fase-1-migracion-011
  asserts:
    - "psql $DATABASE_URL -f shared/migrations/011_validator_ui.sql"
    - "psql $DATABASE_URL -c \"SELECT column_name FROM information_schema.columns WHERE table_name='agent_configs' AND column_name='validation_mode'\" | grep -q validation_mode"
    - "psql $DATABASE_URL -c \"SELECT column_name FROM information_schema.columns WHERE table_name='validator_messages' AND column_name='admin_decision'\" | grep -q admin_decision"
    - "cd web && pnpm typecheck"
  rollback: "psql $DATABASE_URL -f shared/migrations/011_validator_ui.rollback.sql"
```

### Fase 2 — validator-queries.ts + tests
```yaml
phase_contract:
  id: fase-2-queries
  asserts:
    - "cd web && pnpm vitest run tests/unit/admin/validator-queries.test.ts"
    - "cd web && pnpm typecheck"
  rollback: "rm web/lib/admin/validator-queries.ts web/tests/unit/admin/validator-queries.test.ts"
```

### Fase 3 — Server actions nivel message
Archivos: parte de `app/admin/validator/[run_id]/actions.ts` (approve/reject/edit message).
```yaml
phase_contract:
  id: fase-3-message-actions
  asserts:
    - "cd web && pnpm typecheck"
    - "cd web && grep -q 'approveMessageAction' app/admin/validator/[[]run_id[]]/actions.ts"
    - "cd web && grep -q 'requireSuperAdmin' app/admin/validator/[[]run_id[]]/actions.ts"
  rollback: "git checkout HEAD -- web/app/admin/validator"
```

### Fase 4 — Server actions nivel run
Se añaden al mismo `actions.ts` (approveRun, rejectRun, triggerManualAutopatch, rollbackAutopatch).
```yaml
phase_contract:
  id: fase-4-run-actions
  asserts:
    - "cd web && pnpm typecheck"
    - "cd web && grep -q 'rollbackAutopatchAction' app/admin/validator/[[]run_id[]]/actions.ts"
  rollback: "git checkout HEAD -- web/app/admin/validator"
```

### Fase 5 — Server actions nivel tenant + helper rate-limit

Archivos:
- `app/admin/tenants/[id]/actions.ts` (setValidationMode, unpauseAgent, triggerManualRun).
- `web/lib/rate-limit.ts` MODIFICADO: añadir `limitByTenantValidatorManual(tenantId)` al export.

`triggerManualRunAction` internamente llama `limitByTenantValidatorManual` ANTES del fetch al runtime. Si {ok:false}, retorna 429 sin tocar runtime (ahorra round-trip). Si {ok:true}, hace POST.

```yaml
phase_contract:
  id: fase-5-tenant-actions
  asserts:
    - "cd web && pnpm typecheck"
    - "cd web && grep -q 'setValidationModeAction' app/admin/tenants/[[]id[]]/actions.ts"
    - "cd web && grep -q 'limitByTenantValidatorManual' lib/rate-limit.ts"
    - "cd web && grep -q 'limitByTenantValidatorManual' app/admin/tenants/[[]id[]]/actions.ts"
  rollback: "git checkout HEAD -- web/app/admin/tenants web/lib/rate-limit.ts"
```

### Fase 6 — Runner respeta validation_mode
Modificar `runtime/app/validator/runner.py` con `_resolver_validation_mode` + branching skip/manual/auto.
```yaml
phase_contract:
  id: fase-6-runner-mode
  asserts:
    - "cd runtime && source .venv/bin/activate && python -m py_compile app/validator/runner.py"
    - "cd runtime && source .venv/bin/activate && grep -q '_resolver_validation_mode' app/validator/runner.py"
    - "cd runtime && source .venv/bin/activate && pytest tests/ -q"
  rollback: "git checkout HEAD -- runtime/app/validator/runner.py"
```

### Fase 7 — /admin/validator lista

**`page.tsx` contrato Next 16:**
```tsx
export default async function AdminValidatorPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; tenant?: string; since?: string }>;
}) {
  await requireSuperAdmin();
  const { status, tenant, since } = await searchParams;
  // ... getRuns + render tabla + <Filters/> client
}
```

**Progress bar (scores 4 dims):** si `components/ui/progress.tsx` NO existe → usar div Tailwind inline:
```tsx
<div className="h-2 bg-neutral-100 rounded"><div style={{width:`${score*10}%`}} className="h-full bg-neutral-900 rounded"/></div>
```
(No añadir dep shadcn nueva si no hace falta.)

```yaml
phase_contract:
  id: fase-7-lista
  asserts:
    - "cd web && pnpm typecheck"
    - "cd web && pnpm build"
    - "test -f web/app/admin/validator/page.tsx && test -f web/app/admin/validator/filters.tsx"
  rollback: "git checkout HEAD -- web/app/admin/validator"
```

### Fase 8 — /admin/validator/[run_id] detalle
```yaml
phase_contract:
  id: fase-8-detalle
  asserts:
    - "cd web && pnpm typecheck"
    - "cd web && pnpm build"
    - "test -f web/app/admin/validator/[run_id]/page.tsx && test -f web/app/admin/validator/[run_id]/run-actions.tsx && test -f web/app/admin/validator/[run_id]/message-card.tsx"
  rollback: "git checkout HEAD -- web/app/admin/validator/[[]run_id[]]"
```

### Fase 9 — /admin/tenants/[id] + validator-card

**IMPORTANTE:** `web/app/admin/tenants/[id]/page.tsx` NO existe actualmente en el repo (verificado). **CREAR desde cero** con AppShell + info básica del tenant + `<ValidatorCard/>`. No hay riesgo de colisión.

```yaml
phase_contract:
  id: fase-9-tenant-page
  asserts:
    - "cd web && pnpm typecheck"
    - "cd web && pnpm build"
    - "test -f web/app/admin/tenants/[id]/page.tsx && test -f web/app/admin/tenants/[id]/validator-card.tsx"
  rollback: "git checkout HEAD -- web/app/admin/tenants/[[]id[]]"
```

### Fase 10 — /admin KPI runs 24h
```yaml
phase_contract:
  id: fase-10-admin-kpi
  asserts:
    - "cd web && pnpm typecheck"
    - "cd web && pnpm build"
    - "cd web && grep -q 'getRunsKpi24h' app/admin/page.tsx"
  rollback: "git checkout HEAD -- web/app/admin/page.tsx"
```

### Fase 11 — E2E smoke + push
```yaml
phase_contract:
  id: fase-11-e2e
  asserts:
    - "cd web && pnpm typecheck"
    - "cd web && pnpm test:unit"
    - "cd web && pnpm build"
    - "cd web && pnpm test:e2e e2e/08-validator-ui.spec.ts"
  rollback: "git checkout HEAD -- web/e2e/08-validator-ui.spec.ts"
```

---

## 7. Fuera de scope Sprint 3

- Re-ejecutar judge tras edit manual de respuesta.
- Diff visual pre/post autopatch (UI comparando system_prompts).
- Analytics histórico de success rate por nicho.
- Bulk operations (approve 100 runs de 1 click).
- Multi-idioma UI (es only v1).
- Notificaciones push al admin (email ya cubre en Sprint 2).

Spec §9 es fuente de verdad.

---

## 8. Riesgos por fase

| Fase | Riesgo | Mitigación |
|---|---|---|
| 1 | Columnas nuevas aditivas — zero riesgo | — |
| 2 | N+1 en `getRuns` con JOIN tenants | Single SQL con JOIN + limit 50 |
| 3/4 | approve/reject no actualiza verdict final del run | Regenerar verdict si todos messages approved → status='pass'; si any rejected → agent.paused=true |
| 5 | triggerManualRun sin rate-limit cliente + runtime lo rechaza 429 | rate-limit en web antes de fetch (mismo 3/h/tenant) + manejo 429 del runtime |
| 6 | Modificar runner rompe Sprint 2 | Test pytest regression antes de commit; branching aditivo (fallback a auto si override inválido) |
| 7 | tabla runs con >1000 rows lenta | index tenant_id + created_at existente (010) + limit 50 |
| 8 | Cards 20 muy cargadas | Skeleton + progressive disclosure (notes collapsed) |
| 9 | Colisión con `/admin/tenants/[id]` existente | Check antes; si existe, modificar; si no, crear |
| 10 | 2 extra KPIs en home saturan | grid-cols-4 ya soporta |
| 11 | E2E requiere SUPER_ADMIN_EMAIL + ALLOW_DEV_LOGIN | env del CI ya lo tiene (Sprint 1 F6) |

---

## 9. Reglas no negociables

1. **`requireSuperAdmin()` primera línea** de CADA action + page bajo `/admin/*`.
2. **Zod UUID + enum** en todos los inputs.
3. **Audit log** por cada mutación con `action='admin_validator_<verb>'`.
4. **revalidatePath** tras cada mutación.
5. **Server actions, NO API routes** para mutaciones admin.
6. **TypeScript strict** — sin `any`, sin `@ts-ignore`.
7. **Runner F6 aditivo** — si override es NULL y flag no existe: fallback a `skip`. Comportamiento default del sprint 2 se preserva cuando flag global='auto'.
8. **RLS SET LOCAL** ya resuelto en Sprint 2 persist — queries de lista en web van como super_admin (no aplica RLS).
9. **`edit_message_response` NO re-ejecuta judge** — registro trazable, nada más.
10. **Rate-limit client-side** en triggerManualRun antes de fetch runtime.
11. **Cada fase = un commit** con mensaje conventional.
12. **Tests verdes antes de cerrar fase.**
13. **Español en código, commits, docs.**

---

## 10. Handoff

```bash
cd ~/Projects/whatsapp-agentkit
claude "Lee docs/superpowers/blueprints/2026-04-18-validador-ui-blueprint.md y ejecuta las 11 fases. Commit por fase. Pre-ejecutar audit-architect."
```
