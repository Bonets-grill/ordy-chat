# Super Admin v2 — Blueprint Ejecutable (Sprint 1 / 3)

> **Generated:** 2026-04-18 · **Archetype:** Feature en SaaS existente
> **Proyecto:** `/Users/lifeonmotus/Projects/whatsapp-agentkit`
> **Spec fuente:** `docs/superpowers/specs/2026-04-18-super-admin-v2-design.md`
> **Idioma:** español
> **Cambios DB:** CERO

> ⚠️ **Fast-track.** Mario aprobó spec tras brainstorm. Este blueprint salta fases de entrevista.

---

## 1. Objetivo del Sprint

Dar al super admin visibilidad y control read-only+flags sobre lo ya deployado tras onboarding-fast: jobs, warm-up/burned, feature flags con precedencia `platform_settings > env > default`.

**Success metric (verificable pre-merge):**
- `/admin` render <400ms con las 4 KPI cards pobladas.
- Super admin puede togglear `onboarding_fast_enabled` desde UI sin redeploy.
- Reset de un onboarding_job `failed` dispara runtime `/onboarding/scrape` correctamente.

---

## 2. Stack y patrones ya fijados

| Capa | Usar | Fuente pattern |
|---|---|---|
| Auth gate | `auth()` + `session.user.role === "super_admin"` | `web/app/admin/page.tsx` |
| UI wrapper | `<AppShell session={session}>` | idem |
| Cards/Badges | `@/components/ui/card`, `badge` | instalados |
| Forms client | `"use client"` + Server Action | `app/admin/settings/form.tsx` (leer como ejemplo) |
| Cifrado | `cifrar`/`descifrar` de `@/lib/crypto` | `app/api/admin/settings/route.ts` |
| Audit | `INSERT auditLog(userId, action, entity, entityId, metadata)` | patrón existente |
| Validación | Zod en todo server action | ya existente |

**Deps nuevas:** cero. Todo el Sprint 1 usa lo que ya hay.

---

## 2bis. Fuera de scope de este Sprint 1 (NO implementar)

Estos items viven en Sprints 2-3 con sus propios specs. Si un agente builder los ve necesarios, PARAR y pedir nuevo spec:

- `/admin/validator/*` páginas (listado de runs, detalle, review cards).
- `runtime/app/validator/*` módulos (runner de semillas, judge LLM, autopatch).
- Tablas `validator_runs` y `validator_messages` (DB cambios **prohibidos** en Sprint 1).
- Columna `tenants.activation_status` — decidido NO añadir; Sprint 2-3 usan `tenants.paused` existente.
- Envío de mensajes-semilla al bot, scoring LLM, email a tenants tras FAIL.
- Cualquier modificación a `runtime/app/brain.py` o `runtime/app/main.py`.

Fuentes: spec §11 "Scope estrictamente fuera".

---

## 3. Inventario total de archivos

### Nuevos
```
web/lib/admin/auth.ts                                 (requireSuperAdmin helper + cache)
web/lib/admin/flags.ts                                (getFlag / setFlag + cache 30s)
web/lib/admin/queries.ts                              (SQL agregados complejos — N+1 safe)

web/app/admin/flags/page.tsx                          (server)
web/app/admin/flags/flag-form.tsx                     (client)
web/app/admin/flags/actions.ts                        ("use server" — setFlag)

web/app/admin/onboarding-jobs/page.tsx                (server — lista + filtros)
web/app/admin/onboarding-jobs/filters.tsx             (client)
web/app/admin/onboarding-jobs/[id]/page.tsx           (server — detalle)
web/app/admin/onboarding-jobs/[id]/actions-panel.tsx  (client)
web/app/admin/onboarding-jobs/actions.ts              ("use server" — resetJob, deleteJob)

web/app/admin/instances/page.tsx                      (server — lista JOIN)
web/app/admin/instances/filters.tsx                   (client)
web/app/admin/instances/actions.ts                    ("use server" — unburnInstance)

web/tests/unit/admin/flags.test.ts                    (roundtrip + precedencia)
web/tests/unit/admin/auth.test.ts                     (gate super_admin)
web/tests/unit/admin/queries.test.ts                  (instance summary SQL)

web/e2e/07-super-admin-v2.spec.ts                     (smoke login → kpis → flags → toggle)
```

### Modificados
```
web/app/admin/page.tsx                                (añadir 4 KPI cards nuevas + links a flags/onboarding-jobs/instances)
web/app/admin/tenants/page.tsx                        (añadir enlaces nav a /admin/flags, /admin/onboarding-jobs, /admin/instances — solo links UI, sin cambios de lógica)
web/app/onboarding/page.tsx                           (leer flag ONBOARDING_FAST_ENABLED desde getFlag, no env directo)
web/app/api/onboarding/fast/start/route.ts            (opcional: getFlag('onboarding_fast_enabled') si se necesita gate adicional — decisión en Fase 5)
```

**Total:** 16 nuevos + 2-3 modificados. **Zero changes DB.**

---

## 4. Contratos TypeScript

### `web/lib/admin/auth.ts`
```ts
export class AdminAuthError extends Error {
  constructor(public code: "UNAUTHENTICATED" | "FORBIDDEN") {
    super(code);
  }
}

/** Lanza si no hay sesión o role !== 'super_admin'. Usa session.user.role si
 *  ya viene embed en el JWT (Auth.js v5 lo soporta). Evita query extra a users. */
export async function requireSuperAdmin(): Promise<{ userId: string; email: string }>;

/** Wrapper para server actions: captura AdminAuthError y devuelve un shape
 *  consistente, para que el client pueda mostrar error en form sin 500. */
export async function adminAction<T>(fn: () => Promise<T>): Promise<
  { ok: true; data: T } | { ok: false; error: string; code: "UNAUTHENTICATED" | "FORBIDDEN" | "VALIDATION" | "INTERNAL" }
>;
```

### `web/lib/admin/flags.ts`
```ts
export type FlagKey = "onboarding_fast_enabled" | "validation_mode_default" | "warmup_enforce";

export type FlagSpec =
  | { key: "onboarding_fast_enabled"; type: "bool"; default: false; envVar: "ONBOARDING_FAST_ENABLED" }
  | { key: "validation_mode_default"; type: "enum"; options: ["auto","manual","skip"]; default: "skip"; envVar: null }
  | { key: "warmup_enforce"; type: "bool"; default: true; envVar: null };

export const FLAG_SPECS: readonly FlagSpec[];

/**
 * Namespace en platform_settings para evitar colisión con API keys legacy
 * (anthropic_api_key, stripe_secret_key, etc.) que guarda /admin/settings.
 * Storage real: platform_settings.key = `flag.${key}` (ej: `flag.onboarding_fast_enabled`).
 * Los callers usan getFlag(key) sin prefijo; el prefijo se añade internamente.
 */
export const FLAG_KEY_PREFIX = "flag." as const;

/**
 * Serialización en platform_settings.value_encrypted:
 *   1. Se serializa SIEMPRE con `JSON.stringify(value)` → string.
 *   2. Se cifra con `cifrar(str)` (AES-256-GCM de lib/crypto).
 *   3. Para leer: descifrar → JSON.parse → Zod-validar según FlagSpec.type.
 *
 * Env var (fallback): es SIEMPRE string plain. Coerción según tipo:
 *   - bool: "true" → true; "false"|"" → false; otro → default.
 *   - enum: si está en options, úsalo; si no, default.
 *
 * Precedencia: platform_settings (con prefijo `flag.`) > env var > default.
 */

/** Lee flag con precedencia documentada. Cache in-memory 30s per server process. */
export async function getFlag<T = unknown>(key: FlagKey): Promise<T>;

/** Invalida cache in-memory para key específica. Llamar tras setFlag. */
export function invalidateFlagCache(key: FlagKey): void;

/** Zod-valida value según FLAG_SPECS[key].type antes de cifrar+guardar.
 *  Guarda con key prefijada `flag.${key}`. Lanza si mismatch de tipo. */
export async function setFlag(key: FlagKey, value: unknown, updatedBy: string): Promise<void>;
```

### `web/lib/admin/queries.ts`
```ts
export type OnboardingJobsKpis = {
  by_status: Record<"pending"|"scraping"|"sources_ready"|"ready"|"confirming"|"done"|"failed", number>;
  active_count: number;      // pending|scraping|sources_ready|confirming
  failed_24h: number;
};

export async function getOnboardingJobsKpis(): Promise<OnboardingJobsKpis>;

export type InstanceRow = {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  provider: "whapi"|"meta"|"twilio"|"evolution";
  instanceCreatedAt: Date;
  ageDays: number;
  tier: "fresh"|"early"|"mid"|"mature";
  cap: number | null;
  msgHoy: number;
  burned: boolean;
  burnedAt: Date | null;
  burnedReason: string | null;
};

/** Single SQL con JOIN + LEFT LATERAL para evitar N+1. Ver SQL exacto en §6. */
export async function getInstanceRows(opts?: {
  tierFilter?: InstanceRow["tier"];
  burnedOnly?: boolean;
  limit?: number;
  offset?: number;
}): Promise<InstanceRow[]>;

export type InstancesKpis = {
  burnedCount: number;
  warmupInCurso: number;     // provider=evolution AND burned=false AND age<=14d
};

export async function getInstancesKpis(): Promise<InstancesKpis>;
```

### Server actions

```ts
// web/app/admin/flags/actions.ts
"use server";
export async function setFlagAction(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }>;

// web/app/admin/onboarding-jobs/actions.ts
"use server";
export async function resetJobAction(jobId: string): Promise<{ ok: true } | { ok: false; error: string }>;
export async function deleteJobAction(jobId: string): Promise<{ ok: true } | { ok: false; error: string }>;

// web/app/admin/instances/actions.ts
"use server";
export async function unburnInstanceAction(tenantId: string): Promise<{ ok: true } | { ok: false; error: string }>;
```

**Cada acción (contrato rígido):**
1. `await requireSuperAdmin()` — primera línea. Lanza si no super.
2. Zod parse del input. **TODOS los ids son `z.string().uuid()` explícito** (jobId, tenantId, etc.). Keys enum (`FlagKey`) con `z.enum(...)`.
3. Ejecuta mutación.
4. INSERT `auditLog` con `action='admin_<verb>_<entity>'`, `entityId`, `metadata`.
5. `revalidatePath('/admin/<path>')`.
6. Return `{ok: true}` o `{ok: false, error}`.
7. **Logging**: cualquier `.catch()` fire-and-forget DEBE hacer `console.error('[admin-action] <contexto>', err)` mínimo. No silenciosos.

---

## 4bis. Dependencias entre fases

```
Fase 1 (helpers)  ──┬──► Fase 2 (flags page)   ──┐
                    ├──► Fase 3 (onboarding-jobs) ──┐
                    └──► Fase 4 (instances)        ──┼──► Fase 5 (KPI cards + getFlag wire)
                                                    │
                    Fase 2 (getFlag)               ──┘
                                                        │
                                                        ▼
                                                    Fase 6 (E2E + regression wizard)
```

- **Fase 1** no depende de nada (sola mock de `@/lib/db` en tests).
- **Fase 2** importa `getFlag/setFlag` de Fase 1.
- **Fase 3** y **Fase 4** importan `requireSuperAdmin` y (4) `queries.ts` de Fase 1. Independientes entre sí.
- **Fase 5** importa `getFlag` (F1/F2), consume queries KPIs (F1 queries.ts). Modifica `/admin/page.tsx` que muestra links a F3/F4 y toggles de F2.
- **Fase 6** requiere F1-F5 mergeadas para que el E2E smoke pase.

Si alguna fase intermedia bloquea, las posteriores se ponen en pausa.

---

## 5. Build order — 6 fases

### Fase 1 — Helpers + tests unit

**Scope.** Funciones puras + helpers, 0 UI, 0 rutas. Desbloquea todo lo demás.

**Archivos:**
- `web/lib/admin/auth.ts` — `requireSuperAdmin` + `adminAction`.
- `web/lib/admin/flags.ts` — `getFlag`, `setFlag`, `FLAG_SPECS`, cache + invalidate.
- `web/lib/admin/queries.ts` — `getOnboardingJobsKpis`, `getInstanceRows`, `getInstancesKpis`. (Archivo creado aquí; sus usos aparecen en fases 3-5.)
- `web/tests/unit/admin/auth.test.ts`
- `web/tests/unit/admin/flags.test.ts`
- `web/tests/unit/admin/queries.test.ts` — tests con fixtures SQL (mock db).

```yaml
phase_contract:
  id: fase-1-helpers
  asserts:
    - "cd web && pnpm vitest run tests/unit/admin/flags.test.ts tests/unit/admin/auth.test.ts"
    - "cd web && pnpm typecheck"
  rollback: "rm -rf web/lib/admin web/tests/unit/admin"
```

**Notas:**
- `getFlag` cache: `Map<FlagKey, {value, expiresAt}>` module-scope. TTL 30s. Cada server process tiene su copia (aceptable para flags que cambian N veces/día).
- `requireSuperAdmin` lee `session.user.role` del JWT (Auth.js v5 lo tiene embed desde `lib/auth.ts` existente). Si NO existe, hace query `users`. Check implementación real antes.
- Tests mockean `@/lib/db` con vitest.mock.

---

### Fase 2 — `/admin/flags` (página más simple, desbloquea sprints 2-3)

**Scope.** Toggle visible para owner → sprint 2 puede leer `validation_mode_default`.

**Archivos:** `app/admin/flags/page.tsx`, `flag-form.tsx`, `actions.ts`.

**Comportamiento:**
- Server component. `await requireSuperAdmin()`.
- Para cada flag en `FLAG_SPECS`, lee valor con `getFlag(key)`.
- Render: 3 cards (una por flag). Cada card usa `<FlagForm spec={spec} currentValue={v}/>` client component con su propio submit.
- `FlagForm`: `<form action={setFlagAction}>` con input según type (checkbox/select). Muestra error inline si `result.ok=false`.

**Orden de precedencia visible en UI:** mostrar badge "Sourced from: platform_settings / env / default" por cada flag.

```yaml
phase_contract:
  id: fase-2-flags-page
  asserts:
    - "cd web && pnpm typecheck"
    - "cd web && pnpm build"
    - "cd web && pnpm dev & sleep 8 && curl -s -o /dev/null -w '%{http_code}' localhost:3000/admin/flags | grep -E '(302|307)' && pkill -f 'next dev'"  # sin sesión → redirect
  rollback: "git checkout HEAD -- web/app/admin/flags"
```

---

### Fase 3 — `/admin/onboarding-jobs` (lista + filtros + detalle + acciones)

**Scope.** La página más grande.

**Archivos:** `page.tsx`, `[id]/page.tsx`, `filters.tsx`, `[id]/actions-panel.tsx`, `actions.ts`.

**Query lista (ejemplo pattern — evita N+1):**
```ts
const rows = await db
  .select({
    id: onboardingJobs.id,
    status: onboardingJobs.status,
    urls: onboardingJobs.urlsJson,
    error: onboardingJobs.error,
    createdAt: onboardingJobs.createdAt,
    updatedAt: onboardingJobs.updatedAt,
    userEmail: users.email,
  })
  .from(onboardingJobs)
  .innerJoin(users, eq(users.id, onboardingJobs.userId))
  .where(and(/* filters */))
  .orderBy(desc(onboardingJobs.createdAt))
  .limit(50)
  .offset(page * 50);
```

**Reset action:**
```ts
export async function resetJobAction(jobId: string) {
  const { userId } = await requireSuperAdmin();
  const parsed = z.string().uuid().safeParse(jobId);
  if (!parsed.success) return { ok: false, error: "invalid job id" };

  const [job] = await db
    .select()
    .from(onboardingJobs)
    .where(eq(onboardingJobs.id, parsed.data))
    .limit(1);
  if (!job) return { ok: false, error: "not found" };
  if (!["failed", "error"].includes(job.status)) return { ok: false, error: "job no reseteable en estado actual" };

  await db
    .update(onboardingJobs)
    .set({
      status: "pending",
      error: null,
      scrapeStartedAt: null,
      scrapeDeadlineAt: null,
      resultJson: null,
      updatedAt: new Date(),
    })
    .where(eq(onboardingJobs.id, parsed.data));

  await db.insert(auditLog).values({
    userId,
    action: "admin_reset_onboarding_job",
    entity: "onboarding_jobs",
    entityId: parsed.data,
    metadata: { previous_status: job.status, urls: job.urlsJson },
  });

  // Re-disparar runtime scrape (fire-and-forget).
  const runtimeUrl = (process.env.RUNTIME_URL ?? "").replace(/\/$/, "");
  const secret = process.env.RUNTIME_INTERNAL_SECRET ?? "";
  if (runtimeUrl && secret) {
    fetch(`${runtimeUrl}/onboarding/scrape`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": secret },
      body: JSON.stringify({ job_id: parsed.data, urls: job.urlsJson }),
      signal: AbortSignal.timeout(1500),
    }).catch(() => { /* watchdog lo atrapará */ });
  }

  revalidatePath(`/admin/onboarding-jobs/${parsed.data}`);
  revalidatePath("/admin/onboarding-jobs");
  return { ok: true };
}
```

**Delete action:** similar pero con `DELETE` y validación `status IN ('failed','done')`.

```yaml
phase_contract:
  id: fase-3-onboarding-jobs
  asserts:
    - "cd web && pnpm typecheck"
    - "cd web && pnpm build"
    - "cd web && pnpm vitest run tests/unit/admin/queries.test.ts"
  rollback: "git checkout HEAD -- web/app/admin/onboarding-jobs"
```

---

### Fase 4 — `/admin/instances` (JOIN complejo, SQL único)

**Scope.** Tabla con tier + msg_hoy + burned. El SQL es lo crítico.

```yaml
phase_contract:
  id: fase-4-instances
  asserts:
    - "cd web && pnpm typecheck"
    - "cd web && pnpm build"
    - "cd web && pnpm vitest run tests/unit/admin/queries.test.ts"
  rollback: "git checkout HEAD -- web/app/admin/instances"
```

---

### Fase 5 — Enriquecer `/admin` con KPI cards + integrar `getFlag`

**Scope.**
1. `/admin/page.tsx`: añadir las 4 KPI cards nuevas (onboarding jobs hoy, burned, warmup en curso). Mantener las existentes.
2. `/onboarding/page.tsx`: reemplazar `process.env.ONBOARDING_FAST_ENABLED === "true"` por `await getFlag<boolean>("onboarding_fast_enabled")`.

**Notas:**
- NO tocar `/api/onboarding/fast/start`. El gate de producto está en `/onboarding/page.tsx` (redirect). El route API acepta igual — un user puede pegar `/onboarding/fast` directo y eso es OK (el flag solo controla el REDIRECT default).

**Coerción de env var para `onboarding_fast_enabled`** — dentro de `getFlag<boolean>`:
```ts
// Si platform_settings no tiene la key, y existe envVar en FlagSpec:
const raw = process.env[spec.envVar];  // undefined | "true" | "false" | otro
if (raw !== undefined) {
  if (spec.type === "bool") return raw.toLowerCase() === "true";
  // enum: validar que está en options
}
return spec.default;
```

Esto garantiza que el deploy actual (env `ONBOARDING_FAST_ENABLED=true`) sigue funcionando sin cambios mientras la platform_settings permanezca vacía. El toggle UI crea la row con prefijo `flag.onboarding_fast_enabled` que luego gana precedencia.

```yaml
phase_contract:
  id: fase-5-kpi-flag-integration
  asserts:
    - "cd web && pnpm typecheck"
    - "cd web && pnpm build"
    - "cd web && grep -q 'getFlag' app/onboarding/page.tsx"
    - "cd web && pnpm vitest run tests/unit/admin/flags.test.ts --reporter=verbose 2>&1 | grep -E 'env.*true.*coerc|precedence'"  # test debe cubrir coerción env bool
  rollback: "git checkout HEAD -- web/app/admin/page.tsx web/app/onboarding/page.tsx"
```

---

### Fase 6 — E2E smoke + push

**Scope.** Un test E2E de humo + push.

**Archivo:** `e2e/07-super-admin-v2.spec.ts` con 2 tests:
1. Sin sesión → `/admin/flags` redirige a `/signin`.
2. Con super admin session → `/admin/flags` renderiza las 3 flag cards.

**Dev-login en E2E (cómo autenticarse como super admin en Playwright):**
- La app ya tiene `ALLOW_DEV_LOGIN=1` que habilita un provider Credentials en `lib/auth.ts`. Con ese env en el runner CI, Playwright puede loguear via form-post directo:
  ```ts
  await page.goto("/signin");
  await page.getByLabel(/email/i).fill(process.env.SUPER_ADMIN_EMAIL!);
  await page.getByRole("button", { name: /entrar|sign in|dev login/i }).click();
  await page.waitForURL(/\/(dashboard|admin)/);
  ```
- Ver `e2e/02-auth.spec.ts` (preexistente) como referencia exacta del helper.
- Variables necesarias en CI (ya presentes en `ci.yml` del repo): `ALLOW_DEV_LOGIN=1`, `SUPER_ADMIN_EMAIL=e2e-admin@ci.ordychat.local` (matcheado con el del setup).

```yaml
phase_contract:
  id: fase-6-e2e-push
  asserts:
    - "cd web && pnpm build"
    - "cd web && pnpm test:unit"
    - "cd web && pnpm test:e2e e2e/07-super-admin-v2.spec.ts"
    - "cd web && pnpm exec playwright test e2e/03-wizard.spec.ts"  # regression: wizard legacy sigue OK
  rollback: "git checkout HEAD -- web/e2e/07-super-admin-v2.spec.ts"
```

---

## 6. SQL crítico — `getInstanceRows` (N+1 safe)

Query única que devuelve todas las filas con msg_hoy agregado + tier calculado:

```sql
SELECT
  t.id              AS tenant_id,
  t.slug            AS tenant_slug,
  t.name            AS tenant_name,
  pc.provider,
  pc.instance_created_at,
  EXTRACT(DAY FROM (now() - pc.instance_created_at))::int AS age_days,
  CASE
    WHEN pc.provider <> 'evolution' THEN 'mature'
    WHEN EXTRACT(DAY FROM (now() - pc.instance_created_at))::int <= 3 THEN 'fresh'
    WHEN EXTRACT(DAY FROM (now() - pc.instance_created_at))::int <= 7 THEN 'early'
    WHEN EXTRACT(DAY FROM (now() - pc.instance_created_at))::int <= 14 THEN 'mid'
    ELSE 'mature'
  END AS tier,
  CASE
    WHEN pc.provider <> 'evolution' THEN NULL
    WHEN EXTRACT(DAY FROM (now() - pc.instance_created_at))::int <= 3 THEN 30
    WHEN EXTRACT(DAY FROM (now() - pc.instance_created_at))::int <= 7 THEN 100
    WHEN EXTRACT(DAY FROM (now() - pc.instance_created_at))::int <= 14 THEN 300
    ELSE NULL
  END AS cap,
  COALESCE(m.count_hoy, 0) AS msg_hoy,
  pc.burned,
  pc.burned_at,
  pc.burned_reason
FROM provider_credentials pc
INNER JOIN tenants t ON t.id = pc.tenant_id
LEFT JOIN (
  SELECT tenant_id, COUNT(*) AS count_hoy
  FROM messages
  WHERE role = 'assistant'
    -- SARGable: aprovecha idx_msg_tenant(tenant_id, created_at).
    -- NO usar `created_at::date = CURRENT_DATE` — el cast impide el index range scan.
    AND created_at >= date_trunc('day', now())
    AND created_at <  date_trunc('day', now()) + interval '1 day'
  GROUP BY tenant_id
) m ON m.tenant_id = pc.tenant_id
WHERE ($1::text IS NULL OR (
  CASE
    WHEN pc.provider <> 'evolution' THEN 'mature'
    WHEN EXTRACT(DAY FROM (now() - pc.instance_created_at))::int <= 3 THEN 'fresh'
    WHEN EXTRACT(DAY FROM (now() - pc.instance_created_at))::int <= 7 THEN 'early'
    WHEN EXTRACT(DAY FROM (now() - pc.instance_created_at))::int <= 14 THEN 'mid'
    ELSE 'mature'
  END = $1::text
))
  AND ($2::boolean IS NULL OR pc.burned = $2::boolean)
ORDER BY pc.burned DESC, pc.instance_created_at DESC
LIMIT $3::int OFFSET $4::int;
```

**Drizzle way (para usar sql template raw):**
```ts
import { sql } from "drizzle-orm";
const result = await db.execute(sql`/* la query de arriba */`);
```

**Índices ya existentes que cubren:**
- `idx_msg_tenant` (tenant_id, created_at DESC) — cubre el scan del LEFT JOIN.
- PK `provider_credentials` (tenant_id) — cubre el join.

**Benchmark meta:** <100ms para 500 tenants. Si supera → CREATE INDEX nuevo en fase posterior (fuera scope).

---

## 7. Riesgos por fase

| Fase | Riesgo | Mitigación |
|---|---|---|
| 1 | `session.user.role` no viene en JWT (requiere query adicional) | Check `auth.ts` existente; si no viene, `requireSuperAdmin` hace query a users (caso peor: 1 query extra por request admin). Log de la decisión. |
| 1 | Cache in-memory de flags stale 30s tras setFlag | `invalidateFlagCache(key)` dentro de `setFlag` + `revalidatePath`. Documented. |
| 2 | Flag guardado como JSON pero leído como raw string | Zod schema por `FlagSpec.type` en `getFlag` Y en `setFlag`. Roundtrip test unit obligatorio. |
| 3 | Reset dispara runtime scrape — si runtime down, job colgado en `pending` | `AbortSignal.timeout(1500)`; watchdog `/internal/jobs/reap` lo marca failed en 60s. |
| 4 | SQL complejo rompe con >1000 tenants | Benchmark obligatorio con dataset artificial antes merge. Si >200ms, limit paginación + índice extra. |
| 5 | Cambiar `/onboarding/page.tsx` rompe wizard legacy | Test e2e `03-wizard.spec.ts` ya existe; correr antes de push. |
| 6 | ALLOW_DEV_LOGIN sin super_admin crea user normal | Check que el email test === SUPER_ADMIN_EMAIL env. Docs-inline. |

---

## 8. Testing strategy

- **Unit (Vitest):** `flags` (roundtrip + precedencia 3 niveles), `auth` (FORBIDDEN si no super), `queries` (shape del resultado con fixture). Mock db con vitest.mock.
- **Integration (server actions):** test con Drizzle test-fixture (si setup lo permite) — verifica audit_log creado.
- **E2E (Playwright):** 1 archivo, 2 tests (redirect sin auth + render con auth).
- **Build gate:** `pnpm typecheck` + `pnpm build` + `pnpm test:unit` antes cada commit.

---

## 9. Deploy y rollout

1. Fases 1-5 → commits separados por fase → local verde.
2. Fase 6 E2E → ejecutar + commit.
3. `git push origin main` → auto-deploy Vercel (integración reconectada).
4. Post-deploy: manual smoke desde https://ordychat.ordysuite.com/admin/flags.

**Feature flag rollout:** el valor default del `validation_mode_default` es `skip`. Eso garantiza que el sprint 1 NO dispara el validador (aún no existe). Sprint 2 cambiará default a `auto` cuando esté listo.

---

## 10. Skills durante el build

| Skill | Cuándo |
|---|---|
| `/typecheck` | tras cada fase |
| `/simplify` | tras fase 3 y 4 (es donde más fácil se infla) |
| `/security-review` | tras fase 3 (server actions + mutaciones en admin) |
| `/audit-architect` | YA aplicado a este blueprint |
| `/commit` | al cerrar cada fase |
| `/audit-prod` | tras push, antes de confirmar "listo" |

---

## 11. Reglas no negociables

1. **`requireSuperAdmin()` primera línea de CADA server component, page, server action y API route bajo `/admin/*`.** Sin excepciones.
2. **Zod en fronteras** — cada `actions.ts` valida input.
3. **Audit log por cada mutación admin** — nunca un `UPDATE/DELETE` de admin sin entrada en `audit_log`.
4. **`revalidatePath` tras cada mutación** — evita UI stale.
5. **Server actions, NO API routes para mutaciones admin** — reduce superficie HTTP pública.
6. **TypeScript strict** — sin `// @ts-ignore`, sin `any` explícito.
7. **SQL raw solo cuando Drizzle API no alcanza** — y siempre con parámetros tipados.
8. **Zero cambios DB en sprint 1.** Si hace falta schema → para y replantea, NO añadir migration sigilosa.
9. **Cada fase = un commit separado** con mensaje conventional.
10. **Tests verdes antes de cerrar fase** (`phase_contract.asserts` literales).
11. **Compat retroactiva** — env `ONBOARDING_FAST_ENABLED` sigue funcionando durante la transición.
12. **Español en código, commits, comentarios.**

---

## 12. Handoff

Para ejecutar desde cero:

```bash
cd ~/Projects/whatsapp-agentkit
claude "Lee docs/superpowers/blueprints/2026-04-18-super-admin-v2-blueprint.md y ejecuta las 6 fases en orden. Tras cada fase: correr phase_contract.asserts, si verde /commit, luego continuar. Si falla: parar y reportar output literal."
```

Antes del primer commit: ejecutar `/audit-architect` sobre este blueprint → veredicto READY/BLOCKED.
