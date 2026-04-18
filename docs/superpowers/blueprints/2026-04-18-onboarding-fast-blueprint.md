# Onboarding Fast + Anti-Ban Warm-up — Blueprint Ejecutable

> **Generated:** 2026-04-18 · **Archetype:** Feature en SaaS existente
> **Proyecto:** `/Users/lifeonmotus/Projects/whatsapp-agentkit`
> **Spec fuente:** `docs/superpowers/specs/2026-04-18-onboarding-fast-design.md`
> **Idioma:** español (commits + código + comentarios)

> ⚠️ **Fast-track mode.** El owner (Mario) aprobó el spec completo y pidió saltar las fases de entrevista. Este blueprint es ejecutable sin más preguntas.

---

## 1. Objetivo

Sustituir el onboarding-wizard de 9 pasos por un flujo en el que el tenant pega 1+ URLs (web / Google Business / TripAdvisor), el sistema scrapea, fusiona, le pregunta SÓLO los conflictos, y termina mostrándole el QR de Evolution. Tiempo objetivo <2 min. Además: warm-up anti-ban para que las instancias Evolution nuevas no banean en los primeros 14 días.

**Success metric.** Tasa completitud onboarding ≥ 75% (baseline wizard ≈ 40%).

---

## 2. Stack ya fijado — no cambiar

| Capa | Tech | Versión pinneada |
|------|------|------------------|
| Web framework | Next.js 15 App Router | `16.2.4` (ya pinneado en package.json) |
| React | | `19.2.5` |
| TypeScript | strict mode | `^5.6` (del tsconfig existente) |
| ORM | Drizzle | `^0.36.4` |
| DB driver | `@neondatabase/serverless` | `^0.10.3` |
| Validación | Zod | `^3.23.8` |
| LLM | `@anthropic-ai/sdk` | `^0.90.0` |
| Icons | lucide-react | `^0.454.0` |
| Tests | Vitest + Playwright | Playwright `^1.59.1` (ya) |
| Runtime | FastAPI + asyncpg | `>=0.115.0` / `>=0.30.0` |
| Browser headless | Playwright Python | `==1.58.0` (ya) |

**Deps nuevas a instalar:**
- Ninguna en `web/` (se reusa todo lo existente).
- Ninguna en `runtime/` (Playwright ya está).

---

## 3. Archivos afectados — inventario total

### Nuevos
```
shared/migrations/009_onboarding_fast_warmup.sql
web/lib/onboarding-fast/canonical.ts
web/lib/onboarding-fast/sanitize.ts
web/lib/onboarding-fast/merger.ts
web/lib/onboarding-fast/provision.ts
web/lib/scraper/google-business.ts
web/lib/scraper/tripadvisor.ts
web/app/api/onboarding/fast/start/route.ts
web/app/api/onboarding/fast/status/[id]/route.ts
web/app/api/onboarding/fast/confirm/route.ts
web/app/onboarding/fast/page.tsx
web/app/onboarding/fast/fast-wizard.tsx
web/app/onboarding/fast/components/url-input.tsx
web/app/onboarding/fast/components/scraping-spinner.tsx
web/app/onboarding/fast/components/conflict-resolver.tsx
web/app/onboarding/fast/components/qr-display.tsx
web/tests/onboarding-fast/canonical.test.ts
web/tests/onboarding-fast/sanitize.test.ts
web/tests/onboarding-fast/merger.test.ts
web/tests/onboarding-fast/provision.test.ts
web/promptfoo/merger.eval.yaml
web/e2e/onboarding-fast.spec.ts
runtime/app/onboarding_scraper.py
runtime/app/warmup.py
runtime/app/url_safety.py
runtime/tests/test_warmup.py
runtime/tests/test_url_safety.py
web/tests/onboarding-fast/scrapers.test.ts
web/tests/onboarding-fast/routes.test.ts
web/app/api/cron/evolution-health/route.ts
```

### Modificados
```
web/lib/db/schema.ts                 ← añadir onboardingJobs + campos nuevos
web/app/onboarding/page.tsx          ← redirect a /onboarding/fast por defecto
web/app/api/onboarding/route.ts      ← refactor: usar provision.ts
runtime/app/main.py                  ← añadir endpoint /onboarding/scrape + /onboarding/webhook-health
runtime/app/outbound_throttle.py     ← jitter + warm-up cap
runtime/app/providers/evolution.py   ← método sendPresence + healthcheck
runtime/app/providers/base.py        ← interfaz opcional send_presence
runtime/app/memory.py                ← helper contar_mensajes_hoy(tenant_id)
runtime/app/main.py                  ← (YA listado arriba) + usar timingSafeEqual en /onboarding/scrape
vercel.json                          ← añadir cron para /api/cron/evolution-health
```

---

## 4. Variables de entorno nuevas

| Variable | Dónde | Fuente | Opcional |
|----------|-------|--------|----------|
| `ONBOARDING_SCRAPE_MAX_SEC` | web + runtime | constante, default `45` | sí |
| `ANTHROPIC_API_KEY_GLOBAL` | web | `platform_settings.value_encrypted WHERE key='anthropic_key_global'` — YA existe mecanismo de super admin | no |
| `ONBOARDING_FAST_ENABLED` | web (Vercel) | feature flag; `"true"` activa el redirect default a `/onboarding/fast` | sí (default `false`) |
| `CRON_SECRET` | web (Vercel) | autogenerado por Vercel Cron; usar su pattern estándar: header `Authorization: Bearer $CRON_SECRET` | no (solo si se activa el cron de healthcheck) |

Todas las demás (`RUNTIME_URL`, `RUNTIME_INTERNAL_SECRET`, `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `DATABASE_URL`, `AUTH_SECRET`) YA existen.

---

## 5. Schema DB (migración 009)

```sql
-- shared/migrations/009_onboarding_fast_warmup.sql
-- 2026-04-18 · Onboarding Fast + warm-up anti-ban

BEGIN;

CREATE TABLE IF NOT EXISTS onboarding_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  urls_json JSONB NOT NULL,
  status TEXT NOT NULL
    CONSTRAINT onboarding_jobs_status_check
    CHECK (status IN ('pending','scraping','sources_ready','ready','confirming','done','failed')),
  result_json JSONB,
  error TEXT,
  consent_accepted_at TIMESTAMPTZ,   -- confirmación "soy propietario" (fix legal)
  consent_ip INET,                    -- IP del consent (fix legal)
  scrape_started_at TIMESTAMPTZ,
  scrape_deadline_at TIMESTAMPTZ,     -- = scrape_started_at + ONBOARDING_SCRAPE_MAX_SEC
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_jobs_user_recent
  ON onboarding_jobs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_onboarding_jobs_status_pending
  ON onboarding_jobs(status)
  WHERE status IN ('pending','scraping','sources_ready');
-- Índice para el cron de retention (purga >30 días)
CREATE INDEX IF NOT EXISTS idx_onboarding_jobs_result_purge
  ON onboarding_jobs(created_at)
  WHERE result_json IS NOT NULL;

-- RLS defense-in-depth (aunque la app filtra por user_id, defense extra).
ALTER TABLE onboarding_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS onboarding_jobs_owner ON onboarding_jobs;
CREATE POLICY onboarding_jobs_owner ON onboarding_jobs
  FOR ALL
  USING (user_id = current_setting('app.current_user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.current_user_id', true)::uuid);

-- Warm-up anti-ban para Evolution.
-- CRÍTICO: aplicar DEFAULT now() a instancias preexistentes pondría el cap
-- diario en 30 msgs a cuentas ya maduras. Solución: primero añadir columna
-- NULLABLE, backfill con fecha pasada (30 días atrás), luego NOT NULL.
ALTER TABLE provider_credentials
  ADD COLUMN IF NOT EXISTS instance_created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS burned BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS burned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS burned_reason TEXT;

-- Backfill: todas las instancias existentes se consideran "maduras" (30 días = sin cap).
UPDATE provider_credentials
SET instance_created_at = now() - interval '30 days'
WHERE instance_created_at IS NULL;

-- Ahora sí marcar NOT NULL + default para nuevas filas.
ALTER TABLE provider_credentials
  ALTER COLUMN instance_created_at SET NOT NULL,
  ALTER COLUMN instance_created_at SET DEFAULT now();

COMMIT;
```

**Rollback (`shared/migrations/009_onboarding_fast_warmup.rollback.sql`):**
```sql
BEGIN;
DROP POLICY IF EXISTS onboarding_jobs_owner ON onboarding_jobs;
DROP INDEX IF EXISTS idx_onboarding_jobs_result_purge;
DROP INDEX IF EXISTS idx_onboarding_jobs_user_recent;
DROP INDEX IF EXISTS idx_onboarding_jobs_status_pending;
DROP TABLE IF EXISTS onboarding_jobs;
ALTER TABLE provider_credentials
  DROP COLUMN IF EXISTS burned_reason,
  DROP COLUMN IF EXISTS burned_at,
  DROP COLUMN IF EXISTS burned,
  DROP COLUMN IF EXISTS instance_created_at;
COMMIT;
```

---

## 6. Build order — 9 fases con phase_contract

### Fase 1 — Migración 009 + schema Drizzle

**Scope.** Aplicar SQL al Neon, regenerar types Drizzle, sin cambios de código aún.

**Pasos.**
1. Crear `shared/migrations/009_onboarding_fast_warmup.sql` con el SQL del §5.
2. Aplicar a Neon: `psql $DATABASE_URL -f shared/migrations/009_onboarding_fast_warmup.sql`.
3. Añadir a `web/lib/db/schema.ts`:
   - `export const onboardingJobs = pgTable("onboarding_jobs", { … })`
   - Añadir a `providerCredentials` los 4 campos: `instanceCreatedAt`, `burned`, `burnedAt`, `burnedReason`.
4. `pnpm tsx -e "import './lib/db/schema'"` — verifica compile.

```yaml
phase_contract:
  id: fase-1-migracion-009
  asserts:
    - "psql $DATABASE_URL -c \"SELECT 1 FROM information_schema.tables WHERE table_name='onboarding_jobs'\" | grep -q 1"
    - "psql $DATABASE_URL -c \"SELECT column_name FROM information_schema.columns WHERE table_name='provider_credentials' AND column_name='instance_created_at'\" | grep -q instance_created_at"
    - "cd web && pnpm typecheck"
  rollback: "psql $DATABASE_URL -f shared/migrations/009_onboarding_fast_warmup.rollback.sql"
```

---

### Fase 2 — `canonical.ts` + `sanitize.ts` + tests unit

**Scope.** Bases puras sin dependencias de DB ni LLM.

**Archivos.**
- `web/lib/onboarding-fast/canonical.ts` — Zod `CanonicalBusiness` del §3 del spec, **con esta corrección post-auditoría legal 2026-04-18**: elimina `photos_urls` del schema (riesgo RGPD por imágenes con personas). El blueprint es fuente de verdad; el spec queda como doc histórica.
- `web/lib/onboarding-fast/sanitize.ts` — `sanitizeScrapedText(s, maxChars=4000): string` que aplica:
  - Trunc a `maxChars`.
  - Regex strip: `/ignore\s+(all|previous|the above)/gi`, `/system\s*:/gi`, `/you\s+are\s+now/gi`, `/<\|[^|]*\|>/g`, `/\[INST\]/gi`, `/```[\s\S]*?```/g` (code fences).
  - Log a `audit_log(action='prompt_injection_blocked', metadata={pattern, snippet})` cuando detecta.
- `web/tests/onboarding-fast/canonical.test.ts` — roundtrip Zod + casos inválidos.
- `web/tests/onboarding-fast/sanitize.test.ts` — 15 fixtures prompt injection.

```yaml
phase_contract:
  id: fase-2-canonical-sanitize
  asserts:
    - "cd web && pnpm vitest run tests/onboarding-fast/canonical.test.ts tests/onboarding-fast/sanitize.test.ts"
    - "cd web && pnpm typecheck"
  rollback: "rm -rf web/lib/onboarding-fast web/tests/onboarding-fast"
```

---

### Fase 3 — `provision.ts` (refactor DRY del onboarding tradicional)

**Scope.** Extraer la lógica de creación de tenant + agent_config + Evolution instance desde `web/app/api/onboarding/route.ts` a `web/lib/onboarding-fast/provision.ts`. Refactor puro: ambos onboardings (tradicional y fast) llaman aquí.

**Contrato de `provision.ts`:**
```ts
export type ProvisionInput = {
  userId: string;
  canonical: CanonicalBusiness;
  tone: "professional"|"friendly"|"sales"|"empathetic";
  useCases: string[];
  provider: "evolution"|"whapi"|"meta"|"twilio";
  providerCredentials?: Record<string,string>;
  knowledgeText?: string;
  agentName?: string;
  schedule?: string;
};
export type ProvisionResult = { slug: string; tenantId: string; qrUrl?: string };
export async function createTenantFromCanonical(input: ProvisionInput): Promise<ProvisionResult>;
```

**Lógica idéntica a la actual en `route.ts`** — cambios en `route.ts`: reemplazar todo el cuerpo por un mapeo del `parsed.data` al input de provision + llamada.

**Regression test obligatorio:** `provision.test.ts` con fixture igual al wizard actual debe producir el mismo `INSERT` payload (query Drizzle snapshot).

```yaml
phase_contract:
  id: fase-3-provision-refactor
  asserts:
    - "cd web && pnpm vitest run tests/onboarding-fast/provision.test.ts"
    - "cd web && pnpm typecheck"
    - "cd web && pnpm test:e2e --grep 'onboarding tradicional sigue funcionando' || echo 'skip si no hay e2e aún'"
  rollback: "git checkout HEAD -- web/app/api/onboarding/route.ts web/lib/onboarding-fast/provision.ts"
```

---

### Fase 4 — Scrapers nuevos: google-business + tripadvisor + SSRF guard

**Scope.** Dos archivos web que llaman al runtime + módulo `url_safety.py` nuevo en runtime para prevenir SSRF. Worker del runtime importa `renderizar()` directo (no HTTP self-call).

**Archivos runtime.**
- `runtime/app/url_safety.py` — **CRÍTICO (fix SSRF)**. API:
  ```python
  async def es_url_publica(url: str) -> tuple[bool, str | None]:
      """
      Devuelve (True, None) si es URL pública scrapeable.
      Devuelve (False, razón) si es loopback/RFC1918/metadata/otro peligro.
      Valida:
        - scheme ∈ {http, https}
        - resolver DNS → NO debe resolver a: 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12,
          192.168.0.0/16, 169.254.0.0/16 (link-local + metadata AWS/GCP),
          ::1, fc00::/7, fe80::/10
        - hostname NOT IN {'localhost', 'metadata.google.internal', 'metadata.azure.com',
                           '169.254.169.254'}
        - puerto ∈ {80, 443} (rechaza 22, 25, 6379, 5432, etc.)
      """
  ```
- `runtime/tests/test_url_safety.py` — fixtures: `http://127.0.0.1/x`, `http://169.254.169.254/latest/meta-data/`, `http://10.0.0.1/admin`, `http://localhost:6379`, `https://google.com` (la única que pasa).

**Archivos web.**
- `web/lib/scraper/google-business.ts`
  ```ts
  export async function scrapeGoogle(url: string): Promise<Partial<CanonicalBusiness>>;
  ```
  Flujo:
  1. Valida con Zod `url()` en caller (API route), pero **la validación SSRF vive en el runtime** (es quien ejecuta Playwright).
  2. POST al runtime `/onboarding/scrape` con `{url}` (el worker hace SSRF-check + renderiza directo).
  3. Parser intenta en orden:
     a) JSON-LD `<script type="application/ld+json">` con `@type: LocalBusiness|Restaurant`.
     b) Selectores de `maps.google.com/place` (div `[role="main"]`, `[data-attrid="kc:/local:hours"]`, etc.).
  4. Normaliza a `Partial<CanonicalBusiness>`. Todo campo string pasado por `sanitizeScrapedText`.
- `web/lib/scraper/tripadvisor.ts` — mismo patrón con selectores TripAdvisor.

**Whitelist estricta de campos (fix legal — excluye PII de terceros).** Los scrapers devuelven solo el subset:
```
name, description, phone, email, address, hours, website, social,
categories (menú del negocio), rating (número), reviews_count (número),
payment_methods
```
**Explícitamente EXCLUIDOS** del canonical:
- `photos_urls` — removido del schema final (evita imágenes con rostros de clientes, evita hotlinking de CDNs de Google/TripAdvisor).
- Reviews individuales (texto + autor) — son datos personales de terceros.
- Nombres de empleados en cualquier sección.

Si el scraper encuentra estos campos los descarta silenciosamente + log `audit_log(action='scrape_pii_dropped', metadata={field})`.

**Worker runtime (`onboarding_scraper.py`).** En vez de POST HTTP al propio `/render`, **importa directo**:
```python
from app.renderer import renderizar   # Playwright headless
from app.url_safety import es_url_publica

async def ejecutar_scrape(job_id: UUID, urls: dict[str, str]) -> None:
    # Antes de cada URL: es_url_publica() — rechaza si SSRF.
    # Luego: renderizar(url, timeout_ms=25_000).
    # asyncio.gather con timeout total ONBOARDING_SCRAPE_MAX_SEC.
```

**Fixtures offline.** HTML real de 3 perfiles (1 restaurante, 1 clínica, 1 hotel) en `web/tests/fixtures/google/` y `web/tests/fixtures/tripadvisor/` para tests sin red.

```yaml
phase_contract:
  id: fase-4-scrapers-google-tripadvisor
  asserts:
    - "cd web && pnpm vitest run tests/onboarding-fast/scrapers.test.ts"
    - "cd web && pnpm typecheck"
    - "cd runtime && source .venv/bin/activate && pytest tests/test_url_safety.py -v"
    - "cd runtime && source .venv/bin/activate && python -c 'from app.url_safety import es_url_publica; import asyncio; assert asyncio.run(es_url_publica(\"http://169.254.169.254/\"))[0] is False, \"SSRF guard rota\"'"
  rollback: "rm web/lib/scraper/google-business.ts web/lib/scraper/tripadvisor.ts runtime/app/url_safety.py runtime/tests/test_url_safety.py"
```

---

### Fase 5 — Merger LLM + Promptfoo evals

**Scope.** Agente LLM con 2 tools read-only que fusiona las fuentes y marca conflictos.

**Archivo:** `web/lib/onboarding-fast/merger.ts`
```ts
type MergerInput = {
  sources: Array<{ origin: "website"|"google"|"tripadvisor"; data: Partial<CanonicalBusiness> }>;
};
type MergerOutput = {
  canonicos: Partial<CanonicalBusiness>;
  conflictos: Array<{ campo: string; valores: Array<{ origen: string; valor: unknown }> }>;
};
export async function mergeFuentes(input: MergerInput): Promise<MergerOutput>;
```

**Tools expuestas al LLM (solo 2, ambas read-only):**
- `presentar_resumen(canonicos: CanonicalBusiness)` — el LLM pasa los campos fusionados sin conflicto.
- `marcar_conflicto(campo: string, valores: {origen,valor}[])` — por cada discrepancia.

**Modelo.** `claude-sonnet-4-6` (consistente con `runtime/app/brain.py:16`). Máx 1024 tokens, `temperature: 0.2` (tarea determinista).

**System prompt estático** en `merger.ts` — no configurable por tenant. Formato: "Eres un fusionador de datos. Recibirás N fuentes scrapeadas. Por cada campo: si todas las fuentes coinciden o solo una tiene valor, llama `presentar_resumen`. Si dos+ fuentes dan valores distintos, llama `marcar_conflicto`."

**Fallback sin LLM.** Si `ANTHROPIC_API_KEY_GLOBAL` no está configurado, el merger hace fusión determinista: toma el primer valor no-nulo de cada campo y marca conflicto si dos fuentes difieren por igualdad estricta. Esto asegura degradación elegante.

**Evals Promptfoo:**
- Pre-req: `cd web && pnpm add -D promptfoo@^0.96.0` (si no está instalado — verificado 2026-04-18 que no estaba). Scaffold `web/promptfoo/` si no existe.
- Archivo `web/promptfoo/merger.eval.yaml` con 10 fixtures `{fuentes_input → canonicos_esperados + conflictos_esperados}`. Gate CI ≥90% match.

```yaml
phase_contract:
  id: fase-5-merger-llm
  asserts:
    - "cd web && pnpm vitest run tests/onboarding-fast/merger.test.ts"
    - "cd web && npx promptfoo eval -c promptfoo/merger.eval.yaml --pass-threshold 0.9"
    - "cd web && pnpm typecheck"
  rollback: "rm web/lib/onboarding-fast/merger.ts web/promptfoo/merger.eval.yaml"
```

---

### Fase 6 — API routes + runtime scraper worker

**Scope.** Wire-up HTTP en ambos extremos.

**Nuevos endpoints web (`web/app/api/onboarding/fast/`):**

- `POST /start`
  - **Rate limit** (`fix`): reusa patrón `limitByWhatsappSender` existente adaptado a `limitByUserOnboarding` — `5 jobs / hora / user_id` via Upstash (si está configurado) o fallback no-op con warning log.
  - Valida `consent_accepted: boolean` (UI debe pasar `true`) + URLs (al menos 1, `z.string().url()`) — si `consent_accepted !== true` → 400 + log `audit_log(action='onboarding_consent_missing')`.
  - Crea `onboarding_jobs(status='pending', consent_accepted_at=now(), consent_ip=request.headers['x-forwarded-for'] ?? request.ip, urls_json=urls)`.
  - Llama al runtime `POST /onboarding/scrape` con `{job_id, urls}` + header `x-internal-secret`.
  - Responde `{job_id}`.

- `GET /status/[id]`
  - Lee `onboarding_jobs` por `id`.
  - **Ownership check obligatorio**: `WHERE id = $1 AND user_id = $session.user.id`. Si no match → 404 (no 403, para no filtrar existencia).
  - Si `status='sources_ready'`: lanza merger LLM (`mergeFuentes(result_json.sources)`), UPDATE `result_json` con `{sources, canonicos, conflictos}` + `status='ready'`, devuelve el nuevo estado.
  - Devuelve `{status, result_json, error}`.

- `POST /confirm`
  - **Ownership check obligatorio** (igual que `/status`): WHERE `user_id` = sesión.
  - Idempotencia: si `status='done'` ya → 200 con `{slug, qrUrl}` de metadata.
  - Recibe `{job_id, resoluciones, tone, useCases, agentName, provider}`, construye `CanonicalBusiness` final con Zod, llama `createTenantFromCanonical`, UPDATE `status='done'` + metadata `{slug, tenant_id}`.
  - Devuelve `{slug, qrUrl}`.

- **Sin `/scrape-callback`.** El runtime escribe directo a `onboarding_jobs` (comparten `DATABASE_URL`). Menos latencia, menos superficie HTTP. Transiciones: `scraping → sources_ready` o `failed`.

**Comparación segura de secretos (`fix`):**
- Runtime: `hmac.compare_digest(provided, shared_secret)` en lugar de `!=`.
- Web: `crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))` cuando longitudes coinciden. Aplicar en `/onboarding/scrape` (runtime) y cualquier nuevo check de `x-internal-secret` en web.

**Nuevo endpoint runtime:**
- `POST /onboarding/scrape` (protegido con `x-internal-secret` + `hmac.compare_digest`). Recibe `{job_id, urls}`.
- Fire-and-forget con `asyncio.create_task(ejecutar_scrape(job_id, urls))` (NO `BackgroundTasks` de FastAPI — queremos que el task sobreviva al return del request). Devuelve `202` inmediato.
- Worker (`runtime/app/onboarding_scraper.py::ejecutar_scrape`):
  1. UPDATE `scrape_started_at = now()`, `scrape_deadline_at = now() + interval 'ONBOARDING_SCRAPE_MAX_SEC seconds'`, `status='scraping'`.
  2. Para cada URL: `es_url_publica()` check SSRF → si falla, marca fuente como error, continúa.
  3. `asyncio.gather` con **timeout GLOBAL** via `asyncio.wait_for(..., timeout=ONBOARDING_SCRAPE_MAX_SEC)`. Si expira → catch `TimeoutError` → UPDATE `status='failed'`, `error='scrape_timeout'`.
  4. Por fuente OK: `renderizar(url, timeout_ms=25_000)` → sanitize → Partial canonical.
  5. UPDATE `result_json={sources:[...]}` + `status='sources_ready'`.
- **Cron de watchdog** (`runtime/app/main.py` endpoint `GET /internal/jobs/reap`): cada 1 min, busca `onboarding_jobs WHERE status IN ('scraping','pending') AND scrape_deadline_at < now()` → UPDATE `status='failed'`, `error='deadline_exceeded'`. Se dispara desde Vercel cron con passthrough (misma estrategia que healthcheck).

> **Decisión de diseño:** el merger vive en `web/` porque necesita `ANTHROPIC_API_KEY_GLOBAL`. El runtime solo scrapea (Playwright). Orquestación: web en `/status` detecta `sources_ready` → llama merger → pasa a `ready`.

```yaml
phase_contract:
  id: fase-6-api-routes
  asserts:
    - "cd web && pnpm typecheck"
    - "cd web && pnpm vitest run tests/onboarding-fast/routes.test.ts"
    - "cd web && pnpm dev & sleep 8 && curl -s -X POST localhost:3000/api/onboarding/fast/start -H 'Content-Type: application/json' -d '{\"urls\":{\"website\":\"https://example.com\"}}' | jq -e '.job_id' && pkill -f 'next dev'"
    - "cd runtime && source .venv/bin/activate && uvicorn app.main:app --port 8001 & sleep 5 && curl -s -X POST localhost:8001/onboarding/scrape -H 'x-internal-secret: test' -d '{}' -w '%{http_code}' | grep -E '(403|400)' && pkill -f uvicorn"
  rollback: "git checkout HEAD -- web/app/api/onboarding/fast runtime/app/onboarding_scraper.py runtime/app/main.py"
```

---

### Fase 7 — UI onboarding fast

**Scope.** Client components con 5 estados de máquina + consent + QR.

**Pre-requisito — instalar shadcn components faltantes** (los actuales son `badge/button/card/input/textarea`):
```bash
cd web && pnpm dlx shadcn@latest add table radio-group checkbox form label
```
Si algún componente ya existe, el CLI pregunta — responder `n` para no sobrescribir.

**Archivos principales:**
- `web/app/onboarding/fast/page.tsx` — server component. Carga `auth()`, busca último `onboarding_jobs` del user con status activo. Pasa como seed al client. **Next 16 pattern**: `searchParams: Promise<{...}>` → `const { legacy } = await searchParams;`.
- `web/app/onboarding/fast/fast-wizard.tsx` — client (`"use client"`). Máquina de estados:
  - `CONSENT` — **nuevo estado inicial (fix legal)**. Checkbox obligatorio: "Confirmo ser propietario del negocio o tener autorización expresa para configurarlo. Autorizo que Ordy Chat consulte las URLs públicas que proporciono (web/Google/TripAdvisor) para acelerar el onboarding." + link a política de privacidad. Solo al marcar se habilita el botón "Continuar".
  - `INPUT` → form con 3 inputs URL (website/google/tripadvisor, al menos 1 requerido), botón "Scanear". Submit envía `{urls, consent_accepted: true}` a `/start`.
  - `SCRAPING` → spinner con polling cada 2s a `/status/[id]`. Timeout visual a los 45s con botón "Reintentar" (crea nuevo job).
  - `RESOLVING` → `ConflictResolver` con cada conflicto del `result_json`.
  - `PROVIDER` → selector provider (default Evolution) + agentName + useCases (checklist) + tone (4 radios). Submit llama `/confirm`.
  - `QR` → muestra el QR escaneable + instrucciones.

- `components/consent-gate.tsx` — **nuevo (fix legal)**. Renderiza el checkbox + microcopy + link a política. Expone `onAccept: () => void` al padre.

- `components/conflict-resolver.tsx` — props explícitas:
  ```ts
  type ConflictResolverProps = {
    conflictos: Array<{ campo: string; valores: { origen: string; valor: unknown }[] }>;
    onResolve: (resoluciones: Record<string, unknown>) => void;
  };
  ```
  Renderiza:
  - Horarios: tabla por día con `RadioGroup` (web | google | tripadvisor | custom).
  - Strings: `RadioGroup` con vista previa.
  - Arrays (menú): tabla mergeable con `Checkbox` por item.

- `components/qr-display.tsx` — fetch del endpoint de QR Evolution (ya existe), render + polling conexión.

**UX fallback total scraping falla.** En estado `RESOLVING` si `result_json.canonicos` está vacío y `result_json.conflictos` vacío también, render un mini-form con 4 inputs (`businessName`, `businessDescription`, `schedule`, `provider`) y botón secundario "Prefiero el wizard completo" → redirect a `/onboarding?legacy=1`.

**Redirect default.** Modificar `web/app/onboarding/page.tsx`:
```ts
// Next 16: searchParams es Promise
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ legacy?: string }>;
}) {
  const { legacy } = await searchParams;
  if (process.env.ONBOARDING_FAST_ENABLED === "true" && legacy !== "1") {
    redirect("/onboarding/fast");
  }
  // ...render wizard actual
}
```

```yaml
phase_contract:
  id: fase-7-ui
  asserts:
    - "cd web && test -f components/ui/table.tsx && test -f components/ui/radio-group.tsx && test -f components/ui/checkbox.tsx"
    - "cd web && pnpm typecheck"
    - "cd web && pnpm lint"
    - "cd web && pnpm build"
  rollback: "git checkout HEAD -- web/app/onboarding web/components/ui"
```

---

### Fase 8 — Warm-up anti-ban en runtime

**Scope.** Protocolo de escalada + jitter + presence para Evolution.

**Archivos.**
- `runtime/app/warmup.py` — nueva:
  ```python
  async def limite_diario_warmup(tenant_id: UUID) -> int | None:
      """Devuelve el cap diario según edad de instancia. None = sin cap."""
      # SELECT instance_created_at FROM provider_credentials
      # days = (now() - instance_created_at).days
      # if days <= 3: return 30
      # if days <= 7: return 100
      # if days <= 14: return 300
      # return None
  async def mensajes_assistant_hoy(tenant_id: UUID) -> int:
      # COUNT(*) messages role='assistant' created_at::date = CURRENT_DATE
  ```
- `runtime/app/outbound_throttle.py` — modificar:
  - `MIN_INTERVAL_SEC` fijo 1.0 → `jitter_interval()` random.uniform(0.8, 2.0).
  - Añadir función nueva `esperar_con_warmup(tenant_id, phone)` que:
    1. `cap = await limite_diario_warmup(tenant_id)`
    2. Si `cap is not None` y `await mensajes_assistant_hoy(tenant_id) >= cap`: retorna `{blocked: True, reason: 'warmup_cap', cap, sent_today: N}`.
    3. Si no: llama `esperar_turno(phone)` existente pero con jitter.
- `runtime/app/providers/evolution.py` — añadir:
  ```python
  async def enviar_presence_typing(self, telefono: str, duracion_ms: int = 1500) -> None:
      # POST /chat/sendPresence/{instance} {"number": telefono, "presence": "composing", "delay": duracion_ms}
  async def healthcheck_instancia(self) -> dict:
      # GET /instance/connectionState/{instance} → devuelve {"instance":{"state": "open"|"close"|"connecting"}}
  ```
- `runtime/app/providers/base.py` — añadir método opcional `async def enviar_presence_typing(self, telefono, duracion_ms)` con default `pass` (no-op para whapi/meta/twilio por ahora).
- `runtime/app/main.py::_procesar_mensaje` — modificar:
  - Reemplazar `waited = await esperar_turno(msg.telefono)` por `estado = await esperar_con_warmup(tenant.id, msg.telefono)`.
  - Si `estado['blocked']`: log `event='warmup_cap_hit'`, enviar mensaje especial SOLO si día 1-3: "He llegado al límite de mensajes por hoy. Mañana retomamos."; día 4+ silencio.
  - Antes del `enviar_mensaje` final: `await adapter.enviar_presence_typing(msg.telefono, duracion_ms=random.randint(800,2000))` + `await asyncio.sleep(0.3)`.
- **Cron healthcheck.** Nuevo endpoint runtime `GET /internal/health/evolution-all` (protegido con `x-internal-secret` + `hmac.compare_digest`) que itera todas las `provider_credentials WHERE provider='evolution' AND burned=false`, para cada una llama `healthcheck_instancia`, si devuelve `'close'` marca `burned=true, burned_at=now(), burned_reason='disconnected'`.
- **Disparador Vercel Cron.** Nuevo route web `GET /api/cron/evolution-health` (archivo `web/app/api/cron/evolution-health/route.ts`):
  1. Valida header `Authorization: Bearer ${process.env.CRON_SECRET}` (pattern estándar Vercel Cron) con `crypto.timingSafeEqual`.
  2. Hace passthrough al runtime: `fetch(RUNTIME_URL + '/internal/health/evolution-all', { headers: { 'x-internal-secret': RUNTIME_INTERNAL_SECRET } })`.
  3. Devuelve `{ok: true, checked: N, burned: M}` del runtime.
- **`vercel.json`** — añadir:
  ```json
  {
    "crons": [
      { "path": "/api/cron/evolution-health", "schedule": "*/10 * * * *" },
      { "path": "/api/cron/onboarding-reap", "schedule": "* * * * *" }
    ]
  }
  ```
- Similarly `GET /api/cron/onboarding-reap` (nuevo) que hace passthrough a `/internal/jobs/reap` del runtime (watchdog de jobs expirados definido en fase 6).

```yaml
phase_contract:
  id: fase-8-warmup
  asserts:
    - "cd runtime && source .venv/bin/activate && pytest tests/test_warmup.py -v"
    - "cd runtime && source .venv/bin/activate && python -m py_compile app/warmup.py app/outbound_throttle.py app/providers/evolution.py app/main.py"
    - "cd runtime && source .venv/bin/activate && python -c 'from app.warmup import limite_diario_warmup; print(\"import ok\")'"
  rollback: "git checkout HEAD -- runtime/app/warmup.py runtime/app/outbound_throttle.py runtime/app/providers/evolution.py runtime/app/providers/base.py runtime/app/main.py"
```

---

### Fase 9 — E2E Playwright + merge gate

**Scope.** Tests end-to-end que garantizan que el flujo completo funciona antes de merge.

**Archivo:** `web/e2e/onboarding-fast.spec.ts`
- Test 1 (happy): URL web + Google concordantes. Espera QR en <45s. Mock del runtime con respuesta precanned (sin scrape real de Google en CI).
- Test 2 (conflict): web horario "L-V 9-18", Google "L-D 10-22". UI muestra tabla día por día. Elige web para todos. Confirma. QR aparece.
- Test 3 (fallback): todas las URLs dan error. UI muestra mini-form de 4 campos. Rellena. Crea tenant igual.
- Test 4 (regression): llamar directamente `/api/onboarding` (wizard viejo) con payload legacy → sigue funcionando.

**Gate CI.** Añadir a `.github/workflows/ci.yml` (ya existe) un job que corre `pnpm test:e2e` + `pnpm test:unit` + `pnpm promptfoo:eval` (definir script canónico en package.json). Falla merge si alguno falla. El runner CI debe tener `jq` instalado (`apt-get install -y jq` en step de setup).

**Retention cron (fix legal RGPD).** Nuevo endpoint runtime `GET /internal/jobs/purge-results` (protegido `x-internal-secret`): `UPDATE onboarding_jobs SET result_json = NULL WHERE created_at < now() - interval '30 days' AND result_json IS NOT NULL`. Disparador Vercel Cron `GET /api/cron/onboarding-purge` (diario 03:00 UTC, passthrough con `CRON_SECRET`). Añadir a `vercel.json`:
```json
{ "path": "/api/cron/onboarding-purge", "schedule": "0 3 * * *" }
```

```yaml
phase_contract:
  id: fase-9-e2e-gate
  asserts:
    - "cd web && pnpm build"
    - "cd web && pnpm test:e2e e2e/onboarding-fast.spec.ts"
    - "cd web && pnpm vitest run"
    - "cd web && npx promptfoo eval -c promptfoo/merger.eval.yaml --pass-threshold 0.9"
  rollback: "git checkout HEAD -- web/e2e web/.github/workflows"
```

---

## 7. Riesgos y mitigaciones (por fase)

| Fase | Riesgo | Mitigación |
|------|--------|-----------|
| 1 | Migración falla en prod con filas existentes | Defaults en columnas nuevas (`DEFAULT now()`, `DEFAULT false`); ejecutar en horario bajo tráfico. |
| 3 | Refactor rompe wizard actual | Test e2e regression obligatorio en fase-9 Test 4; snapshot del SQL. |
| 4 | Google cambia selectores | Fallback JSON-LD primero; monitor error-rate con alerta >20%/día. |
| 5 | LLM alucina campos | Tools read-only; usuario confirma siempre; fallback determinista si no hay API key. |
| 6 | Runtime scrape timeout | Hard timeout 25s por fuente; status='failed' tras 45s total; UI permite reintentar. |
| 7 | Redirect default rompe usuarios existentes | Query `?legacy=1` como escape hatch; añadir link visible "rellenar a mano". |
| 8 | Warm-up muy estricto frustra tenants | Mensaje claro al usuario final en días 1-3; documentar en dashboard del tenant. |
| 9 | Tests flakey por scraping real | Mocks precanned en CI; tests reales solo en nightly. |

---

## 8. Testing strategy consolidado

- **Unit (Vitest web + pytest runtime):** canonical, sanitize, merger determinista, warmup edad.
- **Integration:** API routes fast/start, fast/status, fast/confirm con fixtures.
- **Regression:** wizard tradicional sigue funcionando (Fase 3 + 9 Test 4).
- **Promptfoo evals:** merger con 10 fixtures, gate 90%.
- **E2E Playwright:** 4 tests (happy, conflict, fallback, regression).
- **Smoke manual:** scrape real de 1 negocio conocido antes de deploy a prod.

---

## 9. Deploy y rollout

**Orden sugerido.**
1. Merge + deploy fases 1–3 (infra + refactor) → produce nada visible al usuario. Safe.
2. Merge + deploy fases 4–5 (scrapers + merger) → endpoints no expuestos aún. Safe.
3. Merge + deploy fase 6 (API routes) → endpoints existen pero no hay UI. Safe.
4. Merge + deploy fase 7 (UI) **detrás de feature flag** `ONBOARDING_FAST_ENABLED` (var de entorno, default `false`). Habilitar para owner primero (testing interno). Luego rampa 10% → 50% → 100%.
5. Merge + deploy fase 8 (warm-up) — afecta tenants existentes. Antes del deploy: UPDATE `provider_credentials SET instance_created_at = now() - interval '15 days' WHERE instance_created_at = <default>` para no aplicar retroactivamente el cap a instancias ya maduras.
6. Merge fase 9 + habilitar gate CI.

**Feature flag.** Añadir a `web/app/onboarding/page.tsx`:
```ts
if (process.env.ONBOARDING_FAST_ENABLED === "true" && searchParams.legacy !== "1") {
  redirect("/onboarding/fast");
}
```

---

## 10. Skills a invocar durante el build

| Skill | Cuándo | Por qué |
|-------|--------|---------|
| `/security-review` | tras fase 2 y fase 6 | sanitize + API routes tienen superficie de input usuario |
| `/cyber-neo` | tras fase 9, antes de merge final | pentest full (OWASP + deps + secrets) |
| `/typecheck` | tras cada fase | gate mínimo |
| `/simplify` | tras fase 5 y 7 | merger y UI son donde más fácil se mete complejidad innecesaria |
| `/lock-verify` | antes de cada commit importante | Mario cierra archivos con locks SHA-256 |
| `/audit-architect` | YA aplicado a este blueprint | 5 auditores paralelos |
| `/commit` | al cerrar cada fase | mensaje conventional |
| `/audit-prod` | tras deploy de fase 4 al 100% | read-only prod check |

---

## 11. Reglas no negociables para el builder

1. **Español en código y commits.** Sin excepciones.
2. **Multi-tenant siempre.** Toda query NO-global incluye `tenant_id`. Las tablas globales son `users`, `platform_settings`, `onboarding_jobs` (esta última por `user_id`).
3. **Zod en fronteras.** Todo request body, todo response body, todo contenido scrapeado → Zod. Nunca `any`.
4. **TypeScript strict.** `tsc --noEmit` sin errores es gate. No `// @ts-ignore`.
5. **Secrets en `.env` o `platform_settings` cifrados.** Nunca en git.
6. **Ningún commit sin firma SSH.** `commit.gpgsign=true` del repo.
7. **Cada fase es un commit separado.** Título conventional-commits + Co-Authored-By Claude.
8. **Tests verdes antes de cerrar fase.** `phase_contract.asserts` todos pasando literal.
9. **Refactor de `onboarding/route.ts` en fase 3 NO rompe el wizard actual.** Test regression obligatorio.
10. **El runtime NO confía nunca en input del usuario.** Todo webhook valida firma / shared secret. Endpoint `/onboarding/scrape` valida `x-internal-secret`.
11. **El merger LLM NO tiene tools destructivas.** Solo read-only (`presentar_resumen`, `marcar_conflicto`).
12. **Warm-up NO se aplica retroactivamente.** Instancias preexistentes mantienen `instance_created_at` con fecha old enough para estar "maduras".

---

## 12. Warnings post-auditoría (documentados, no bloquean build)

De la auditoría `audit-architect` del 2026-04-18, estos puntos NO se implementan dentro del blueprint pero quedan registrados:

1. **Política de privacidad + Registro de Actividades de Tratamiento (RAT).** Legal (art.30 RGPD) — fuera de scope del código, pero obligatorio antes de go-live prod. Owner actualiza `web/app/(legal)/privacidad/page.tsx` manualmente con el texto que mencione scraping de perfiles públicos con consentimiento del propietario.
2. **DPA Anthropic + SCCs.** Verificar firmado y archivado. Los datos scrapeados pasan a Anthropic (USA) vía `ANTHROPIC_API_KEY_GLOBAL`. Sin DPA no se debe habilitar el feature flag en prod.
3. **CSP `img-src`.** Si en el futuro se re-añade `photos_urls` al canonical, restringir `img-src` en `next.config.ts` a `'self' data: https://*.googleusercontent.com https://*.tacdn.com` para evitar pixel tracking de terceros.
4. **Selectores Google Maps frágiles.** `[data-attrid="kc:/local:hours"]` y afines pueden romper sin aviso. Monitor error-rate en fase 4 (≥20%/día → alerta). JSON-LD fallback mitiga en parte.
5. **Inconsistencia de nomenclatura "Next.js 15".** El `package.json` pinnea `next@16.2.4`. Se mantiene "Next.js 15" en el texto porque el App Router es el mismo modelo mental; actualizar a "Next.js 16" si causa confusión al builder.
6. **Spec §4 diagrama residual con Inngest.** Limpiar el spec post-merge (no bloquea blueprint ejecutable).
7. **Upstash throttle in-process → distribuido.** `runtime/app/outbound_throttle.py:11` ya reconoce que el dict in-memory no se comparte entre workers Railway. Deuda técnica fuera de este sprint.

---

## 13. Handoff

Para ejecutar este blueprint desde cero:

```bash
cd ~/Projects/whatsapp-agentkit
# Leer el spec primero
cat docs/superpowers/specs/2026-04-18-onboarding-fast-design.md
# Leer el blueprint
cat docs/superpowers/blueprints/2026-04-18-onboarding-fast-blueprint.md
# Pedirle a Claude Code:
claude "Lee docs/superpowers/blueprints/2026-04-18-onboarding-fast-blueprint.md y ejecuta las 9 fases en orden. Tras cada fase: correr phase_contract.asserts literal, si verde commit con /commit, luego continuar. Si falla: parar y reportar output literal."
```

Antes del primer commit: ejecutar `/audit-architect` con este blueprint como input → veredicto READY/BLOCKED.
