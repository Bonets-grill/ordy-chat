# Onboarding Fast — Design Spec

**Fecha:** 2026-04-18
**Proyecto:** whatsapp-agentkit (Ordy Chat)
**Autor:** Mario + Claude
**Estado:** Aprobado en brainstorm, pendiente blueprint (the-architect) + audit (audit-architect)

---

## 1. Problema y objetivo

**Problema.** El onboarding tradicional es un wizard de 9 pasos. Fricción alta: los tenants abandonan. Ya hay scraper web en `web/lib/scraper/`, pero no se usa en el onboarding.

**Objetivo.** Que un tenant entre, pegue 1+ URLs (web / Google Business / TripAdvisor), el sistema scrapea todo, fusiona, detecta conflictos entre fuentes, le pregunta SOLO los conflictos, y termina mostrándole el QR de Evolution. Tiempo objetivo: <2 min desde landing hasta QR.

**No-goals.**
- No eliminar el wizard tradicional — queda como fallback secundario.
- No soportar más de 3 fuentes en v1.
- No hacer scraping recurrente (solo 1 vez en onboarding; v2 posible).

## 2. Decisiones de arquitectura (tomadas en brainstorm)

| Decisión | Elegido | Descartado | Por qué |
|---|---|---|---|
| Posición vs wizard | Default `/onboarding` = fast | Opción lateral | Mario odia wizard 9 pasos; el mini-form de 4 campos cubre el caso "no tengo URL". |
| Scraping Google | Playwright via `/render` del runtime + JSON-LD fallback | SerpAPI, HTML puro | SerpAPI ≈$50/mes no escala; HTML frágil; Playwright ya existe y autenticado. |
| Scraping TripAdvisor | Mismo patrón Playwright | — | Consistencia. |
| Agente fusor | LLM nuevo con 2 tools read-only | Tocar `runtime/app/brain.py` | Aislamiento: el runtime sigue siendo el bot WhatsApp puro. |
| Anti-ban warm-up | Mismo sprint | Sprint posterior | Onboarding fast crea instancias nuevas = las que banean. Lanzar sin warm-up = fabricar burnouts. |
| Conflict UI | Web diff lado a lado | Chat WhatsApp | WhatsApp aún no conectado en esta fase. |
| Fallback total | Mini-form 4 campos + link a wizard | Caer al wizard automático | 4 campos ≤ 9 pasos. |
| Estado intermedio | Tabla `onboarding_jobs` + polling 2s | WebSocket/SSE | Scrape total <30s; polling es más simple. |
| Job runner | Runtime FastAPI (Railway) | Inngest, Vercel background | **Corrección 2026-04-18:** Inngest NO está instalado (verificado en package.json). El runtime ya corre 24/7 en Railway con Playwright + DB pool — mismo patrón que `/render`. Web hace POST a `/onboarding/scrape` con `RUNTIME_INTERNAL_SECRET`; runtime escribe `onboarding_jobs.result_json` cuando termina. |

## 3. Campos canónicos (`CanonicalBusiness`)

Superset de lo que ya extrae `lib/scraper/extract.ts`:

```ts
// lib/onboarding-fast/canonical.ts
const CanonicalBusiness = z.object({
  name: z.string().min(2).max(200),
  description: z.string().max(2000).optional(),
  phone: z.string().max(40).optional(),
  email: z.string().email().optional(),
  address: z.string().max(500).optional(),
  hours: z.string().max(500).optional(),           // "L-V 9:00-18:00, S 10:00-14:00"
  website: z.string().url().optional(),
  social: z.record(z.string(), z.string().url()).optional(),  // instagram, facebook...
  categories: z.array(z.object({
    name: z.string(),
    description: z.string().optional(),
    items: z.array(z.object({
      name: z.string(),
      price: z.string().optional(),
      description: z.string().optional(),
      allergens: z.array(z.string()).optional(),
    })).optional(),
  })).optional(),
  // Nuevos vs extract.ts actual:
  rating: z.number().min(0).max(5).optional(),
  reviews_count: z.number().int().nonnegative().optional(),
  photos_urls: z.array(z.string().url()).max(10).optional(),
  payment_methods: z.array(z.string()).optional(),
});
```

**Regla de fusión:** la ausencia de un campo en una fuente NO es conflicto. Conflicto = dos fuentes dan valores distintos para el MISMO campo.

## 4. Data flow

```
Landing /onboarding/fast
   │
   │ usuario pega {website?, google?, tripadvisor?}
   ▼
POST /api/onboarding/fast/start
   │
   │ inserta onboarding_jobs(status='pending')
   │ inngest.send("onboarding.scrape", {job_id})
   ▼
   responde {job_id}
   │
   │ (background, <30s)
   ▼
Inngest "onboarding.scrape" function:
   1. UPDATE onboarding_jobs SET status='scraping'
   2. Promise.all([
        scrapeWebsite(urls.website),     // usa lib/scraper/ existente
        scrapeGoogle(urls.google),        // NUEVO, via runtime /render
        scrapeTripadvisor(urls.tripadvisor), // NUEVO, via runtime /render
      ])
   3. Cada resultado → sanitize.ts → Partial<CanonicalBusiness>
   4. Merger LLM recibe {fuentes: [...]} como user content
   5. Merger devuelve {canonicos, conflictos[]}
   6. UPDATE onboarding_jobs SET status='ready', result_json=...
   │
   ▼
Frontend polling GET /api/onboarding/fast/status/:job_id cada 2s
   │
   │ status='ready'
   ▼
Render UI diff (horarios como tabla por día si conflicto, radios para strings)
   │
   │ usuario resuelve
   ▼
POST /api/onboarding/fast/confirm {job_id, resoluciones}
   │
   │ Zod valida CanonicalBusiness final
   │ createTenantFromCanonical() (extraído de onboarding tradicional)
   │   → insert tenants + agent_configs + provider_credentials
   │   → createInstance Evolution con warmup state inicial
   ▼
   responde {slug, qr_url}
   │
   ▼
Frontend muestra QR → usuario escanea → fin
```

## 5. Componentes y boundaries

### 5.1 `web/lib/onboarding-fast/`
- `canonical.ts` — Zod schema `CanonicalBusiness`, zero lógica. Fuente de verdad.
- `sanitize.ts` — `sanitizeScrapedText(s): string`. Strip patrones injection + trunc 4KB/campo.
- `merger.ts` — agente LLM con tools `presentar_resumen` y `marcar_conflicto` (ambas read-only). Recibe JSON tipado, devuelve `{canonicos, conflictos[]}`.
- `provision.ts` — `createTenantFromCanonical(userId, canonical, provider)`. **Extraído de `app/api/onboarding/route.ts` existente** para DRY. Ambos onboardings llaman aquí.

### 5.2 `web/lib/scraper/`
Reuso + añadidos:
- `google-business.ts` — **NUEVO**. `scrapeGoogle(url): Partial<CanonicalBusiness>`. Llama `/render` del runtime con selectores + fallback JSON-LD.
- `tripadvisor.ts` — **NUEVO**. Mismo patrón.
- `fetcher.ts`, `parser.ts`, `extract.ts`, `format.ts` — existentes, sin cambios.

### 5.3 `web/app/api/onboarding/fast/`
- `start/route.ts` — POST. Valida URLs, crea job, dispara Inngest.
- `status/[id]/route.ts` — GET. Lee `onboarding_jobs`.
- `confirm/route.ts` — POST. Valida resoluciones + llama `createTenantFromCanonical`.

### 5.4 `web/app/onboarding/fast/`
- `page.tsx` — server component, carga job activo si existe.
- `fast-wizard.tsx` — client. 3 estados: (url-input, scraping-spinner, conflict-resolution, qr-ready).

### 5.5 `web/lib/inngest/functions/scrape-onboarding.ts`
Inngest function. Retry 2x con backoff. Timeouts por fuente 25s.

### 5.6 Anti-ban warm-up (runtime)
- `runtime/app/outbound_throttle.py` — añadir `limite_diario_warmup(pool, tenant_id)` que consulta `provider_credentials.instance_created_at` + cuenta mensajes del día. Jitter 0.8–2.0s reemplaza el 1.0s fijo.
- `runtime/app/providers/evolution.py` — nuevo método `enviar_presence_typing(telefono, duracion_ms)` antes de `enviar_mensaje`.
- Llamado desde `main.py::_procesar_mensaje` ANTES de `enviar_mensaje`.

## 6. Schema DB (migración 009)

```sql
-- shared/migrations/009_onboarding_fast_and_warmup.sql

CREATE TABLE IF NOT EXISTS onboarding_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  urls_json JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','scraping','ready','confirming','done','failed')),
  result_json JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_onboarding_jobs_user_recent
  ON onboarding_jobs(user_id, created_at DESC);

ALTER TABLE provider_credentials
  ADD COLUMN IF NOT EXISTS instance_created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS burned BOOLEAN NOT NULL DEFAULT false;
```

## 7. Anti-prompt-injection (4 capas, crítico)

1. **Datos ≠ instrucciones.** Scraper produce JSON tipado con Zod. Nunca texto libre del HTML al LLM.
2. **Rol user.** JSON va como `user` content, jamás como `system`. El system prompt del merger es estático, definido en código, no influenciable.
3. **Tools read-only.** El merger LLM SOLO puede llamar `presentar_resumen(datos)` y `marcar_conflicto(campo, valores)`. NO tiene tool que escriba DB. El INSERT lo hace el backend Next.js tras confirmación explícita del usuario humano.
4. **Sanitize.** `lib/onboarding-fast/sanitize.ts` strip patrones `ignore previous|system:|you are now|<\|.*\|>`, trunc 4KB/campo. Audit_log cada bloqueo.

## 8. Warm-up anti-ban — protocolo

| Fase | Edad instancia | Límite msgs/día | Fuente |
|---|---|---|---|
| Fresh | 0–3 días | 30 | tabla `messages` WHERE tenant_id + role='assistant' + created_at > today |
| Early | 4–7 días | 100 | idem |
| Mid | 8–14 días | 300 | idem |
| Mature | 15+ días | sin cap diario (solo `max_messages_per_hour`) | — |

**Presencia humana:** antes de cada `enviar_mensaje`, `sendPresence composing` con duración random 800–2000ms, luego jitter 0.8–2.0s en el throttle (reemplaza el 1.0s exacto actual).

**Detección de ban:** si Evolution devuelve `{state: 'disconnected'}` o similar en healthcheck (cron cada 10min), marcar `provider_credentials.burned=true`. Dashboard muestra al tenant "tu instancia fue desconectada" con botón "crear nueva" (nueva instancia, nuevo QR, warm-up reinicia).

**Mensaje al cliente cuando se excede cap diario (solo días 1-3):**
> "He llegado al límite de mensajes por hoy. Mañana retomamos. Gracias por tu paciencia."

Días 4+ silencioso — se degrada a rate-limit normal.

## 9. Testing

### Unit
- `sanitize.test.ts` — 15 fixtures de prompt injection conocidos.
- `canonical.test.ts` — Zod schema roundtrip + campos inválidos.
- `merger.test.ts` — 3 fixtures (concordantes / 1 conflicto / N conflictos) con respuesta LLM mockeada.
- `warmup.test.py` — `limite_diario_warmup` para edad 1/4/8/15 días.

### Integration
- `/api/onboarding/fast/confirm` con fixture completo → verifica tenant idéntico al que produciría el wizard tradicional con input equivalente. **Regression gate.**

### E2E Playwright
- Happy path: web + Google concordantes → QR en <30s.
- Conflict path: web dice "L-V 9-18", Google dice "L-D 10-22" → UI muestra tabla día-por-día, usuario elige, confirma, QR aparece.

### Promptfoo evals (merger LLM)
- 10 fixtures con `{fuentes_input, canonicos_esperados, conflictos_esperados}`.
- Gate CI: ≥90% match. Menos de eso bloquea merge.

## 10. Orden de build (para `the-architect` blueprint)

Propuesta de fases (the-architect puede refinar):

1. **Migración 009** — tabla `onboarding_jobs` + columnas `instance_created_at` / `burned`.
2. **`canonical.ts` + `sanitize.ts` + tests unit** — bases sin dependencias.
3. **`provision.ts`** — extraer de onboarding tradicional + regression test que el wizard sigue funcionando.
4. **Scrapers nuevos** (`google-business.ts`, `tripadvisor.ts`) con fixtures HTML offline para tests.
5. **`merger.ts`** + Promptfoo evals.
6. **Inngest function** + API routes `/start`, `/status`, `/confirm`.
7. **UI** (`fast-wizard.tsx`).
8. **Warm-up runtime** (`outbound_throttle.py` + `evolution.py` presence).
9. **E2E Playwright** + merge gate.

## 11. Riesgos conocidos

| Riesgo | Mitigación |
|---|---|
| Google cambia selectores → scraper rompe | Fallback JSON-LD; monitor con alerta si `scrapeGoogle` error-rate >20%/día. |
| Google bloquea IP del runtime | User-agent real + jitter entre scrapes; si bloqueo persistente, añadir proxy residencial (no en v1). |
| LLM fusor alucina campos | Tools read-only garantizan que alucinación no escribe DB. Usuario confirma siempre. |
| Warm-up muy restrictivo frustra tenants | Mensaje claro en días 1-3. Plan "Pro" sube cap (v2). |
| Inngest queue delay | Timeout frontend 45s → si no ready, botón "reintentar"; estado persistido. |
| Instancia burned sin detección | Healthcheck cron cada 10min + dashboard banner visible. |

## 12. Abierto para the-architect decidir

- Nombres exactos de Inngest events.
- Si el `outbound_throttle` in-memory se migra ya a Upstash o queda para v2 (comentario `outbound_throttle.py:11` ya reconoce la deuda).
- Si `photos_urls` se persiste (dónde) o solo se muestra en preview del conflict UI.
