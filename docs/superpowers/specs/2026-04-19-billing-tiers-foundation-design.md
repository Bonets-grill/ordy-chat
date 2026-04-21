# Billing Tiers Foundation — Design Spec

**Fecha:** 2026-04-19
**Sub-sprint:** 1 de 7 del paquete billing-self-service (ver §11 para dependencias)
**Proyecto:** whatsapp-agentkit (Ordy Chat)
**Estado:** aprobado tras brainstorm combinado (5 decisiones Q1-Q5), pendiente /autoplan pre-implementation review

---

## 1. Objetivo

Introducir 3 tiers de suscripción (`starter`, `pro`, `business`) en Stripe y en la DB local, con webhook que mantiene `tenants.tier` y `tenants.stripe_price_id` sincronizados contra la subscription de Stripe. **Zero cambio de UX** en onboarding y zero disrupción para tenants existentes.

Esto es la capa cimiento. Los otros 6 sub-sprints (portal self-service, Starter caps, white-label, custom domain, public API, priority support) todos construyen sobre estas dos columnas.

**Success metric.** Tras el deploy:
1. `SELECT tier, count(*) FROM tenants GROUP BY tier` devuelve 100% `pro` (grandfather).
2. Cambiar el Stripe subscription de un tenant de prueba de `STRIPE_PRICE_ID_PRO` a `STRIPE_PRICE_ID_STARTER` dispara el webhook, y `SELECT tier, stripe_price_id FROM tenants WHERE id = ?` refleja `starter` + nuevo price_id en <30s.
3. Onboarding fast sigue completando al QR en <2 min (no se añade picker).

**No-goals** (explícitamente fuera — cada uno es su propio sub-sprint):
- Portal self-service tenant (sub-sprint 2).
- Feature gates por tier — NADA en app/runtime consulta `tenant.tier` todavía (sub-sprint 3).
- White-label / custom domain / public API / priority support (sub-sprints 4-7).
- Plan picker en onboarding (futuro sprint `onboarding-plan-picker` si Mario lo decide — Q5 dijo "no").
- Cambio del `brain.py` del runtime (no se toca).

---

## 2. Decisiones del brainstorm (Q1-Q5 aprobadas 2026-04-19)

| Q | Decisión | Justificación |
|---|---------|---------------|
| Q1 | Pricing direction: **3 tiers con upgrade/downgrade en portal futuro** | Producto va hacia segmentación por segmento de cliente. |
| Q2 | **Starter €9.90 / Pro €49.90 / Business €49.90** — cubre SMB hasta premium | Tiers con diferenciación clara. Business depende de features futuras (sub-sprints 4-7). |
| Q3 | **Billing-tiers-foundation ONLY** (este spec). Feature gates + white-label + custom domain + public API + priority support decomposed en sub-sprints 3-7 | Evita mega-spec. Cada sub-sprint revisable, shippable, atómico. |
| Q4 | **Grandfather zero-disrupción**: current Stripe price se convierte en Pro price. Migración DB pone `tier='pro'` en todos los tenants existentes. | Cero churn, cero re-auth de card, cero cancellation risk. |
| Q5 | **Onboarding default Pro** (sin picker). Sub-sprint 2 añade portal post-signup para cambiar. | Preserva promesa "<2 min al QR". |

## 3. Decisiones arquitecturales

### 3.1 Storage: híbrido tier denormalizado + stripe_price_id audit

`tenants.tier` (enum) + `tenants.stripe_price_id` (text). Ambas columnas. Webhook escribe las dos en el mismo UPDATE. App lee `tier` directamente (<1ms, cero latency). Admin/auditor lee `stripe_price_id` para reconciliation contra Stripe dashboard.

Rechazado: solo-`tier` (pierde audit trail, drift indetectable si webhook falla) y solo-`stripe_price_id` (forzaría match contra env vars en cada request, brittle o slow).

### 3.2 Mapeo price_id → tier

Función pura en `web/lib/billing/tiers.ts`:

```typescript
import { stripePriceIdPro, stripePriceIdStarter, stripePriceIdBusiness } from "@/lib/stripe";

export type Tier = "starter" | "pro" | "business";

export async function priceIdToTier(priceId: string): Promise<Tier | null> {
  const [starter, pro, business] = await Promise.all([
    stripePriceIdStarter(),
    stripePriceIdPro(),
    stripePriceIdBusiness(),
  ]);
  if (priceId === starter) return "starter";
  if (priceId === pro) return "pro";
  if (priceId === business) return "business";
  return null; // price_id desconocido → NO modificar tier, log warning
}
```

**Regla de oro:** si Stripe devuelve un price_id que no matchea ninguno de los 3 envs, el webhook **NO** modifica `tenants.tier` ni `tenants.stripe_price_id`. Log WARNING + skip. Evita downgrade accidental si alguien crea un price experimental en Stripe.

### 3.3 Env vars (3 nuevos, 1 existente preservado)

| Env var | Propósito | Origen |
|---|---|---|
| `STRIPE_PRICE_ID` | **Preservado como alias de `STRIPE_PRICE_ID_PRO`** para compatibilidad con código Checkout existente | Existe |
| `STRIPE_PRICE_ID_STARTER` | Stripe Price ID tier Starter (€9.90/mo) | NUEVO |
| `STRIPE_PRICE_ID_PRO` | Stripe Price ID tier Pro (€49.90/mo, == actual `STRIPE_PRICE_ID`) | NUEVO |
| `STRIPE_PRICE_ID_BUSINESS` | Stripe Price ID tier Business (€49.90/mo) | NUEVO |

**Fallback pattern.** Igual que `stripePriceId()` actual: primero env var, después `platform_settings` encrypted. Consistente con `stripeSecretKey`, `stripeWebhookSecret`.

`STRIPE_PRICE_ID` se mantiene pointing al mismo Stripe Price que `STRIPE_PRICE_ID_PRO`. Tras deploy, el código Checkout sigue funcionando sin cambios (sub-sprint 2 le meterá el picker).

### 3.4 Stripe config (ops — acción manual del owner, NO código)

Pasos que Mario ejecuta en Stripe Dashboard ANTES de deployear el webhook extendido:

1. **Product "Ordy Chat Subscription"** ya existe (current). NO se crea nuevo product.
2. **Crear Stripe Price `Starter`**: €9.90/mo EUR recurring, attached al mismo Product. Copiar `price_xxx` → env `STRIPE_PRICE_ID_STARTER`.
3. **Crear Stripe Price `Business`**: €49.90/mo EUR recurring, attached al mismo Product. Copiar `price_xxx` → env `STRIPE_PRICE_ID_BUSINESS`.
4. **Renombrar Stripe Price actual** (el de €49.90/mo) a nickname `Pro` desde el dashboard. Su ID no cambia. Copiar ese ID (== current `STRIPE_PRICE_ID`) también a `STRIPE_PRICE_ID_PRO`.
5. Añadir los 3 envs a Vercel project settings (prod + preview).

Steps 2-5 se documentan en `docs/superpowers/runbooks/billing-tiers-foundation-ops.md` (nuevo, creado durante la fase 0 del build).

### 3.5 VAT / impuestos

**Zero cambio.** Los 3 prices heredan la configuración tax actual del Product (Stripe Tax o manual según esté hoy). Sub-sprint futuro puede revisar VAT + tax_strategy por país — fuera scope aquí.

---

## 4. Schema DB (migración 016)

```sql
-- shared/migrations/016_tenants_tier.sql
BEGIN;

-- 1. Añadir columnas nullable para poder poblar sin lock largo.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS tier TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_price_id TEXT;

-- 2. Backfill: todos los tenants existentes → 'pro'. Grandfather zero-disrupción.
UPDATE tenants SET tier = 'pro' WHERE tier IS NULL;

-- 3. Enforce NOT NULL + CHECK. Default 'pro' para nuevos rows
--    (consistente con onboarding fast que mete tenants en Pro).
ALTER TABLE tenants
  ALTER COLUMN tier SET NOT NULL,
  ALTER COLUMN tier SET DEFAULT 'pro';

ALTER TABLE tenants
  ADD CONSTRAINT tenants_tier_check
  CHECK (tier IN ('starter', 'pro', 'business'));

-- 4. Index para queries por tier (admin filters, feature gate reads en sub-sprint 3).
CREATE INDEX IF NOT EXISTS idx_tenants_tier ON tenants(tier);

-- NOTA: stripe_price_id queda nullable porque tenants en trial (sin subscription
-- activa) pueden no tener price_id todavía. Webhook lo rellena en el primer
-- customer.subscription.created/updated.

COMMIT;
```

Rollback:
```sql
BEGIN;
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_tier_check;
DROP INDEX IF EXISTS idx_tenants_tier;
ALTER TABLE tenants DROP COLUMN IF EXISTS tier;
ALTER TABLE tenants DROP COLUMN IF EXISTS stripe_price_id;
COMMIT;
```

**Drizzle schema update** en `web/lib/db/schema.ts`:

```typescript
// En pgTable "tenants" (existente), añadir:
tier: text("tier").notNull().default("pro"),
stripePriceId: text("stripe_price_id"),
```

Con CHECK constraint documentado en comentario TS (Drizzle no soporta CHECK en builder todavía — la constraint la enforce la DB).

---

## 5. Estructura de archivos

### Nuevos
```
shared/migrations/016_tenants_tier.sql
shared/migrations/016_tenants_tier.rollback.sql
web/lib/billing/tiers.ts                       # priceIdToTier + tipos Tier
web/tests/unit/billing-tiers.test.ts           # mapping + edge cases
docs/superpowers/runbooks/billing-tiers-foundation-ops.md
```

### Modificados
```
web/lib/stripe.ts                              # añadir stripePriceIdStarter/Pro/Business helpers
web/lib/db/schema.ts                           # +2 columnas en tenants
web/app/api/stripe/webhook/route.ts            # extender subscription.updated con priceIdToTier
web/tests/unit/stripe-webhook.test.ts          # (si existe) añadir casos tier-update
```

### NO modificados (explícito)
- `web/app/api/stripe/checkout/route.ts` — sigue usando `stripePriceId()` que alias al Pro price. Sub-sprint 2 lo toca.
- `web/app/billing/page.tsx` — ya existe pero es sub-sprint 2.
- `runtime/app/*` — cero touches. Feature gates son sub-sprint 3.
- `web/app/onboarding/fast/*` — cero touches (Q5 decidió: sigue defaulting a Pro).

---

## 6. Extensión webhook (el único cambio de lógica)

**Archivo:** `web/app/api/stripe/webhook/route.ts`, líneas 101-118 (case `customer.subscription.updated/created/deleted`).

**Cambio:**

```typescript
case "customer.subscription.updated":
case "customer.subscription.created":
case "customer.subscription.deleted": {
  const sub = event.data.object as Stripe.Subscription;
  const tenantId = (sub.metadata?.tenant_id as string) ?? null;
  if (!tenantId) break;

  // Extraer price_id del primer item de la subscription.
  // Ordy Chat tiene 1 sola line-item por tenant (la suscripción base).
  // Sub-spec 2 añadirá metered add-ons; entonces revisaremos este lookup.
  const priceId = sub.items.data[0]?.price.id ?? null;

  // Mapear price_id → tier. Si price_id desconocido: NO modificar tier
  // (protección contra Stripe prices experimentales que romperían el CHECK).
  const tier = priceId ? await priceIdToTier(priceId) : null;

  const updates: Partial<typeof tenants.$inferInsert> = {
    subscriptionStatus: mapStatus(sub.status),
    stripeSubscriptionId: sub.id,
    updatedAt: new Date(),
  };

  if (priceId && tier) {
    updates.tier = tier;
    updates.stripePriceId = priceId;
  } else if (priceId && !tier) {
    console.warn(
      `[stripe-webhook] tenant=${tenantId} priceId=${priceId} no matchea tier conocido — skip tier update`,
    );
  }

  await db.update(tenants).set(updates).where(eq(tenants.id, tenantId));
  break;
}
```

**Idempotencia** ya está cubierta por el `stripeEvents` INSERT en las líneas 42-54 del mismo archivo. Si Stripe reintenta el mismo event.id, el segundo insert falla ON CONFLICT y devolvemos 200 duplicate sin reprocesar.

**Checkout.session.completed (líneas 64-99)** — **NO se modifica** en este spec. Al completar checkout, el webhook ya crea la subscription con `tenants.stripeSubscriptionId`. El siguiente `customer.subscription.created` (que Stripe dispara inmediatamente después) poblará `tier` + `stripe_price_id`. Esperamos ~2-5s de delay entre checkout.session.completed y subscription.created — aceptable (tier default `pro` del schema cubre el gap).

---

## 7. Seguridad

1. **Webhook signature verification** — ya implementado en líneas 37-45. No se toca.
2. **CHECK constraint** en DB (`tier IN ('starter','pro','business')`) — cualquier INSERT/UPDATE fuera del enum falla a nivel Postgres. Defense-in-depth.
3. **price_id desconocido = skip** — evita que un experimento en Stripe cree un 4º "tier" silencioso en DB.
4. **Zero privilege escalation path** — este spec solo lee Stripe events (ya firmados) y escribe 2 columnas. No añade superficie de ataque.
5. **audit_log** — cada tier change genera row en `audit_log` con `action='tenant_tier_changed'`, `entity='tenants'`, `entityId=tenantId`, `metadata={from: oldTier, to: newTier, priceId}`. Permite reconstruir historia de upgrades/downgrades.
6. **RLS** — la tabla `tenants` ya tiene RLS policies (migración 005). El webhook escribe con conexión de admin (no pasa por RLS). Queries tenant-facing seguirán filtrando por `tenant_id = current_tenant_id()` como siempre.

---

## 8. Performance y coste

- **Query path de lectura de tier**: `tenant.tier` es columna plain text — 1 index scan en `idx_tenants_tier` si filtras por tier, o simple SELECT single-row por tenant. <1ms.
- **Webhook extension**: añade 1 Promise.all de 3 env reads (cacheable) + 1 string compare + 1 extra UPDATE clause. <5ms overhead sobre el webhook actual.
- **Stripe API calls**: cero nuevas. Todo lo que necesitamos viene ya en `event.data.object` (la Subscription).
- **Coste mensual**: cero incremental. No llamamos a Stripe API más de lo que ya hacemos.

---

## 9. Testing

### Unit (vitest web)
- `test billing-tiers.test.ts`:
  - `priceIdToTier(starterId)` → `'starter'`
  - `priceIdToTier(proId)` → `'pro'`
  - `priceIdToTier(businessId)` → `'business'`
  - `priceIdToTier('price_unknown')` → `null`
  - `priceIdToTier('')` → `null`

### Integration (vitest con DB de test)
- Aplicar migración 016 contra DB vacía + datos fixture.
- Tenant con `tier IS NULL` antes de backfill → `'pro'` después.
- INSERT tenant sin tier → default `'pro'`.
- INSERT tenant con `tier='starter'` → OK.
- INSERT tenant con `tier='enterprise'` → ERROR CHECK constraint violation.

### Webhook integration (vitest + Stripe mock)
- Mock `customer.subscription.updated` con price_id Pro → tenant.tier='pro', stripe_price_id=Pro.
- Mock `customer.subscription.updated` con price_id Business → tenant.tier='business', stripe_price_id=Business.
- Mock con price_id desconocido → tenant.tier NO cambia, warning loggeado.
- Verificar idempotencia: mismo event.id dos veces → procesado una vez.

### Smoke test manual post-deploy
1. Crear tenant de prueba vía onboarding fast.
2. `SELECT tier, stripe_price_id FROM tenants WHERE id = ?` → `pro` + priceId de Pro.
3. En Stripe dashboard, cambiar su subscription a Starter price.
4. Esperar <30s, re-query → `starter` + priceId de Starter.
5. Cambiar a Business → `business` + priceId de Business.
6. Delete tenant de prueba.

---

## 10. Orden de build (4 fases)

### Fase 0 — Stripe ops (manual, 15 min)
Mario ejecuta pasos §3.4 en Stripe Dashboard + Vercel. Documentado en runbook. **Claude NO ejecuta**.

### Fase 1 — Migración 016 + Drizzle schema
- SQL forward + rollback.
- Schema.ts update con las 2 columnas.
- Aplicar migración contra Neon main.
- Verificar backfill: `SELECT tier, count(*) FROM tenants GROUP BY tier` debe devolver solo `pro`.

**Contract:**
```yaml
asserts:
  - psql $DATABASE_URL -f shared/migrations/016_tenants_tier.sql
  - psql $DATABASE_URL -c "SELECT count(*) FROM tenants WHERE tier IS NOT NULL" | grep -qv "^ 0$"
  - psql $DATABASE_URL -c "SELECT tier FROM tenants GROUP BY tier" | grep -q pro
  - cd web && pnpm typecheck
rollback: psql $DATABASE_URL -f shared/migrations/016_tenants_tier.rollback.sql
```

### Fase 2 — Helpers Stripe env vars + mapping function
- `web/lib/stripe.ts`: añadir `stripePriceIdStarter/Pro/Business` helpers (copia el pattern de `stripePriceId`).
- `web/lib/billing/tiers.ts`: `priceIdToTier` + tests unitarios.

**Contract:**
```yaml
asserts:
  - cd web && pnpm typecheck
  - cd web && pnpm vitest run tests/unit/billing-tiers.test.ts
rollback: git checkout HEAD -- web/lib/stripe.ts web/lib/billing/ web/tests/unit/billing-tiers.test.ts
```

### Fase 3 — Extender webhook subscription handler
- Modificar case `customer.subscription.updated/created/deleted` según §6.
- Test webhook con mock Stripe subscription.
- Deploy a Vercel prod.

**Contract:**
```yaml
asserts:
  - cd web && pnpm typecheck
  - cd web && pnpm build
  - cd web && pnpm vitest run tests/unit/stripe-webhook.test.ts
rollback: git checkout HEAD -- web/app/api/stripe/webhook/route.ts
```

### Fase 4 — Smoke prod + runbook docs
- Ejecutar smoke test manual §9.
- Commit del runbook `billing-tiers-foundation-ops.md`.
- Tag: `billing-tiers-foundation-done`.

**Contract:**
```yaml
asserts:
  - curl -sf https://ordychat.ordysuite.com/api/health 2>&1 | grep -q ok   # sanity
  - echo "smoke manual ejecutado y documentado en runbook"
rollback: (N/A — solo docs + verificación)
```

---

## 11. Dependencias con otros sub-sprints

Este spec es cimiento. La cadena completa:

```
#1 billing-tiers-foundation   (ESTE SPEC)
        │
        ├──► #2 billing-self-service-portal  (tenant portal UI, change tier, cancel)
        │
        ├──► #3 tier-feature-gates           (Starter caps: hide validator, Whapi only, 1 seat)
        │
        ├──► #4 white-label                  (Business: logo/colors/brand)
        │
        ├──► #5 custom-domain                (Business: ordy.clinic.com)
        │         ▲
        │         └── depende también de #4 (branding)
        │
        ├──► #6 public-api                   (Business: REST API + OAuth2)
        │
        └──► #7 priority-support             (Business: Slack queue, SLA)
```

Cada uno de #2-#7 tendrá su propio spec + blueprint + /autoplan + ejecución cuando Mario los priorice.

---

## 12. Riesgos

| Riesgo | Mitigación |
|---|---|
| Envs `STRIPE_PRICE_ID_*` mal configuradas en Vercel — webhook falla silenciosamente | Fase 4 smoke test verifica los 3 prices en prod. Si algún env falta, el log WARNING aparece en Vercel logs. |
| Tenant existente con `stripeSubscriptionId IS NULL` (estado trial sin card) tras migración 016 — `stripe_price_id` sigue NULL indefinidamente | OK. Nullable por diseño (§4 nota). Cuando completen checkout, el webhook rellena. |
| Stripe webhook llega antes que la migración 016 (race durante deploy) | Fase 1 (migración) ejecuta ANTES que Fase 3 (código webhook). Los tenants ya tienen `tier` populated antes de que el webhook extendido esté live. |
| Alguien crea un Stripe Price experimental atado al mismo Product — webhook NO modifica tier, pero admin puede preguntarse por qué no refleja | Log WARNING en webhook + `stripe_price_id` NO actualizado es la señal. Documentado en runbook. Admin debe añadir env var o borrar el price. |
| Mario cambia el €49.90 de Pro a €24.90 en el futuro — tenants actuales heredan nuevo precio porque están en el mismo Stripe Price | **Expected behavior** per Q4 opción A. Si quisiera grandfather price-lock, era Q4 opción B. Documentado. |
| Query lenta tras millones de tenants en `idx_tenants_tier` | Index ya definido. Postgres maneja millones sin problema con este index. Revisitable si llega el escalado. |
| `updates` object en TS con `Partial<typeof tenants.$inferInsert>` no type-checks bien | Alternativa: construir 2 objects separados (uno con tier, otro sin) y usar `...spread`. Micro-detail, no blocker. |

---

## 13. Fuera de scope explícito

- Portal UI self-service (sub-sprint 2).
- Plan picker en onboarding (futuro — Q5 decidió "no por ahora").
- Feature gates por tier — nada en código consulta `tenant.tier` en este spec (sub-sprint 3).
- White-label / custom domain / public API / priority support (sub-sprints 4-7).
- Proration logic para tier changes — **Stripe lo maneja automáticamente** con `proration_behavior: 'create_prorations'` (default). No tenemos que codificarlo.
- VAT / tax_strategy revisión.
- Migración de metered billing (futuro, si lo añades).
- Email notification al tenant cuando cambia su tier (sub-sprint 2 lo añade, vía Customer Portal de Stripe que manda emails automáticos).

---

## 14. Handoff

Tras aprobación de este spec por Mario:

1. **Next command:** `/autoplan` pre-implementation review de este spec. Pipeline CEO → Eng (Design + DX se skipearán por scope — no hay UI nueva, no es API pública).
2. **Post-autoplan READY:** `the-architect` → blueprint ejecutable en `docs/superpowers/blueprints/2026-04-19-billing-tiers-foundation-blueprint.md`.
3. **Post-blueprint:** `audit-architect` → 5 auditores paralelos → veredicto READY/BLOCKED.
4. **Ejecutar** las 4 fases con commit separado por fase. Mario ejecuta Fase 0 (Stripe dashboard) antes de que Claude empiece Fase 1.
