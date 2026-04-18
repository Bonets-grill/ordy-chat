# Super Admin v2 — Design Spec

**Fecha:** 2026-04-18
**Sprint:** 1 de 3 (super-admin-v2 → validador-core → validador-ui)
**Proyecto:** whatsapp-agentkit (Ordy Chat)
**Estado:** aprobado en brainstorm, pendiente blueprint + audit

---

## 1. Objetivo

Dar al super admin visibilidad y control sobre lo que ya existe en producción tras el deploy del onboarding fast: jobs de onboarding, estado warm-up/burned de instancias Evolution, y toggles globales sin redeploy.

**No-goals (Sprint 1):**
- Validador de agentes (Sprints 2-3).
- Edición masiva de tenants.
- Observabilidad histórica (gráficas temporales) — solo estado "ahora".

**Success metric.** El owner puede, sin tocar código ni Vercel CLI:
1. Ver cuántos onboarding jobs hay en curso / fallidos hoy.
2. Saber qué instancias Evolution están `burned` y por qué.
3. Activar/desactivar `ONBOARDING_FAST_ENABLED` en 2 clicks.

## 2. Decisiones tomadas

| Decisión | Elegido | Descartado |
|---|---|---|
| Schema DB | 0 cambios. Usa `onboarding_jobs`, `provider_credentials`, `platform_settings`, `tenants` existentes. | Tabla nueva `admin_kpi_cache`. |
| Auth | Reusa gate existente `users.role='super_admin'` + `requireSuperAdmin()` helper. | Middleware nuevo. |
| Server vs Client | Server components para lectura (rápido + seguro). Client solo para forms y acciones mutativas. | Full-client con SWR. |
| Feature flag storage | `platform_settings.value_encrypted` (ya existe, AES-256-GCM). | Nueva tabla `feature_flags`. |
| UI base | shadcn-compatible (button, card, badge, input ya instalados + label nuevo de fase 7). | Instalar Table/DataTable. Usamos tablas HTML semánticas estilizadas con Tailwind. |

## 3. Rutas y archivos

### Nuevos

```
web/app/admin/onboarding-jobs/page.tsx        (server)
web/app/admin/onboarding-jobs/[id]/page.tsx   (server, detalle)
web/app/admin/onboarding-jobs/actions.ts      (server actions: reset, delete)
web/app/admin/instances/page.tsx              (server)
web/app/admin/instances/actions.ts            (server actions: unburn)
web/app/admin/flags/page.tsx                  (server)
web/app/admin/flags/flag-form.tsx             (client component)
web/app/admin/flags/actions.ts                (server actions: set flag)
web/app/api/admin/onboarding-jobs/route.ts    (opcional: JSON API solo si hace falta)
web/lib/admin/auth.ts                         (requireSuperAdmin() helper)
web/lib/admin/flags.ts                        (getFlag/setFlag con descifrar/cifrar)
web/tests/unit/admin/flags.test.ts
```

### Modificados

```
web/app/admin/page.tsx                        (enriquecer con KPI cards)
web/app/admin/tenants/page.tsx                (añadir link a onboarding-jobs y instances)
```

## 4. Páginas

### 4.1 `/admin` (modificado)

Header existente. Debajo: grid de 4 KPI cards server-rendered:
- **Tenants activos** — `SELECT COUNT(*) FROM tenants WHERE subscription_status IN ('trialing','active')`.
- **Onboarding jobs hoy** — `SELECT status, COUNT(*) FROM onboarding_jobs WHERE created_at > now() - interval '24 hours' GROUP BY status`. Muestra 6 chips por status con colores.
- **Instancias burned** — `SELECT COUNT(*) FROM provider_credentials WHERE burned=true`.
- **Warm-up en curso** — `SELECT COUNT(*) FROM provider_credentials WHERE provider='evolution' AND burned=false AND instance_created_at > now() - interval '14 days'`.

Cada card es un link a su página detalle. Debajo: links a las 4 sub-páginas (`/admin/settings`, `/admin/tenants`, `/admin/onboarding-jobs`, `/admin/instances`, `/admin/flags`).

### 4.2 `/admin/onboarding-jobs`

Tabla server-rendered con columnas: `user_email` (join con users), `urls` (resumida `website + google + tripadvisor` chips), `status` (badge color), `created_at` (relative: "hace 3 min"), `error` (truncado 60 chars + tooltip full), `actions` (link a detalle).

Filtros: dropdown por `status` (default: todos menos `done`), input email search, rango fecha (últimas 24h/7d/30d). Pagination 50 por página.

### 4.3 `/admin/onboarding-jobs/[id]`

Detalle completo de un job. Muestra:
- Header: status badge + timestamps (created, scrape_started, scrape_deadline, updated).
- URLs y consent (`consent_accepted_at` + `consent_ip`).
- `result_json` pretty-printed con código coloreado.
- `error` (si existe) en bloque rojo.

Acciones (botones):
- **Reset**: UPDATE status='pending', error=NULL, scrape_started_at=NULL, scrape_deadline_at=NULL, result_json=NULL, updated_at=now(). Luego POST al runtime `/onboarding/scrape` con las urls_json. Solo si status IN ('failed','error').
- **Delete**: DELETE FROM onboarding_jobs WHERE id=$1 (CASCADE). Confirmación modal. Solo si status IN ('failed','done') — nunca si está activo.

### 4.4 `/admin/instances`

Tabla con JOIN `provider_credentials ⋈ tenants`. Columnas:
- tenant slug + name (link a `/admin/tenants/[id]`)
- provider badge
- `instance_created_at` (relative)
- `tier` calculado (`fresh`/`early`/`mid`/`mature`) con color
- `msg_hoy / cap` — COUNT messages WHERE role='assistant' AND created_at::date=today + cap desde `warmup.calcular_cap(days)`. Evitar N+1: calcular días + cap en SQL con CASE, y hacer un solo COUNT agregado GROUP BY tenant_id.
- `burned` badge
- `burned_at` + `burned_reason` (tooltip)

Filtros: tier, burned. Acción por fila: **Unburn** (UPDATE burned=false, burned_at=null, burned_reason=null). Solo si burned=true.

### 4.5 `/admin/flags`

Lista fija de flags soportados + su valor actual:

| Key | Tipo | Default | Descripción |
|---|---|---|---|
| `onboarding_fast_enabled` | bool | false | Redirect default a `/onboarding/fast` |
| `validation_mode_default` | enum(auto\|manual\|skip) | skip | Modo del validador para nuevos tenants (sprint 2-3) |
| `warmup_enforce` | bool | true | Kill-switch: si false, el warm-up no bloquea ningún envío |

UI: cada flag es una card con su toggle/select + botón save. Al guardar → server action `setFlag(key, value)` que hace UPSERT a `platform_settings` con `value_encrypted=cifrar(JSON.stringify(value))`.

Lectura desde el resto del código: helper `getFlag(key)` que lee + descifra + parsea + cachea (cache in-memory 30s para evitar hit por request).

**Compat con env vars existentes.** Durante transición: `ONBOARDING_FAST_ENABLED` env var se lee si el flag en DB no está seteado. Así el deploy actual sigue funcionando. Orden de precedencia:
1. Valor en `platform_settings`.
2. Valor en env var.
3. Default.

## 5. API / server actions

### Server actions (preferido — seguro por defecto, no HTTP público)

```ts
// web/app/admin/onboarding-jobs/actions.ts
"use server";
export async function resetJob(jobId: string): Promise<void>;
export async function deleteJob(jobId: string): Promise<void>;

// web/app/admin/instances/actions.ts
export async function unburnInstance(tenantId: string): Promise<void>;

// web/app/admin/flags/actions.ts
export async function setFlag(key: string, value: unknown): Promise<void>;
```

Cada acción:
1. Llama `requireSuperAdmin()` primera línea (lanza si no es super admin).
2. Valida input con Zod.
3. Ejecuta mutación.
4. Log a `audit_log(action='admin_*', userId=session.user.id, entity, entityId, metadata)`.
5. `revalidatePath('/admin/...')`.

### API routes

Solo si externos lo necesitan. Sprint 1 NO abre endpoints HTTP — server actions son suficientes.

## 6. `requireSuperAdmin()` helper

```ts
// web/lib/admin/auth.ts
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function requireSuperAdmin(): Promise<{ userId: string; email: string }> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("UNAUTHENTICATED");
  }
  const [u] = await db
    .select({ id: users.id, email: users.email, role: users.role })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  if (!u || u.role !== "super_admin") {
    throw new Error("FORBIDDEN");
  }
  return { userId: u.id, email: u.email };
}
```

Server components usan la throw → Next.js error boundary muestra 403. Server actions capturan y devuelven el error al client.

## 7. Seguridad

- Todo `/admin/*` gate por role. YA existe en `/admin/page.tsx` (verificar patrón en fase implementación). `requireSuperAdmin()` centraliza.
- Server actions son la superficie mutable. NO exponer endpoints HTTP para las mismas mutaciones (superficie duplicada).
- `platform_settings.value_encrypted` con AES-256-GCM (existente).
- `audit_log` entry por cada mutación admin (ya existe patrón en `/admin/settings`).
- Input Zod en cada action.
- `flags.value` se parsea con Zod según tipo esperado por key.

## 8. Testing

### Unit
- `lib/admin/flags.test.ts`: getFlag/setFlag roundtrip (mock db). Precedencia settings > env > default.
- `lib/admin/auth.test.ts`: requireSuperAdmin rechaza no-auth + no-super.

### Integration
- Tests de server actions con Drizzle mock — verifica audit_log escrito + revalidatePath llamado.

### E2E
- `web/e2e/07-super-admin-v2.spec.ts`: login super admin → ve `/admin` KPIs → navega a onboarding-jobs → navega a flags → toggle `onboarding_fast_enabled` → ve cambio reflejado.

## 9. Orden de build

1. **Helpers + schema.** `lib/admin/auth.ts`, `lib/admin/flags.ts`, tests unit.
2. **Página /admin/flags**. La más simple, desbloquea sprint 2 (que necesita `validation_mode_default`).
3. **Página /admin/onboarding-jobs** (lista + detalle + acciones).
4. **Página /admin/instances** (lista + unburn).
5. **Enriquecer /admin/page.tsx** con KPI cards.
6. **E2E smoke**.

## 10. Riesgos

| Riesgo | Mitigación |
|---|---|
| Query N+1 en /admin/instances (cap + msg_hoy por tenant) | SQL único con subquery agregado + CASE para tier. Benchmarks con >100 tenants antes de merge. |
| Cache de flags 30s puede servir valor stale tras setFlag | Invalidar cache in-memory en `setFlag` + `revalidatePath`. |
| `requireSuperAdmin()` llamado en cada request añade 1 query users | Cache por sesión (sessionStorage o re-uso de session.user con role embed). Ver implementación. |
| Reset de job dispara runtime scrape — si runtime está down, el reset deja el job colgado | Server action intenta POST 1s timeout + si falla, job queda en `pending`. El watchdog `/internal/jobs/reap` se encarga a los N segundos. |
| Compat flag `ONBOARDING_FAST_ENABLED` env var vs platform_settings | Orden de precedencia documentado + helper `getFlag` único punto de verdad. |

## 11. Scope estrictamente fuera (para Sprint 2-3)

- `/admin/validator` (listar runs).
- Ejecución del validador de agentes.
- Tabla `validator_runs` / `validator_messages`.
- `tenants.activation_status` (decidido NO crearlo — usar `paused` existente).

Lo referente a estas viene en sus propios specs.

## 12. Handoff

Tras aprobación del spec:
1. `the-architect` produce `docs/superpowers/blueprints/2026-04-18-super-admin-v2-blueprint.md`.
2. `audit-architect` valida (5 auditores) → READY.
3. Implementación por fases con commits separados por archivo.
4. Push → auto-deploy (integración Vercel ya reconectada).
