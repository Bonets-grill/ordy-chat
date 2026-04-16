# Deploy Ordy Chat

Guía paso a paso para poner Ordy Chat en producción. Tiempo estimado: **40 minutos**.

## Lo que vas a necesitar

| Servicio | Coste | Para qué |
|---|---|---|
| [Neon](https://console.neon.tech) | $0 free tier | Postgres (ya creado: project `empty-block-73744049`) |
| [Vercel](https://vercel.com) | $0 hobby | Hospedar `web/` (Next.js) |
| [Railway](https://railway.app) | $5/mes min | Hospedar `runtime/` (FastAPI Python) |
| [Anthropic](https://platform.anthropic.com) | pay-as-you-go | API de Claude |
| [Stripe](https://stripe.com) | comisión sobre ventas | Cobrar €19.90/mes |
| [Resend](https://resend.com) | $0 / 3k emails mes | Emails de magic link |

Cuenta de GitHub: ya tienes el repo en `Bonets-grill/ordy-chat`.

---

## 1. Variables que ya tienes generadas

Abre `SECRETS-GENERATED.txt` (local, no está en git). Contiene:
- `ENCRYPTION_KEY` — 32 bytes base64 para cifrado AES
- `AUTH_SECRET` — firma de JWT/sesiones de Auth.js
- `RUNTIME_INTERNAL_SECRET` — secreto compartido web ↔ runtime
- `DATABASE_URL` — Neon (reemplaza la password)

---

## 2. Crear cuenta Resend (magic link emails) — 3 min

1. Entra a [resend.com](https://resend.com) y regístrate.
2. Verifica el dominio `ordychat.com` (o uno tuyo). Si no tienes dominio, usa el dominio sandbox de Resend para pruebas.
3. En **API Keys**, crea una nueva. Cópiala: `re_...`
4. Te queda: `AUTH_RESEND_KEY=re_...` y `AUTH_EMAIL_FROM=noreply@tu-dominio.com`

---

## 3. Crear cuenta Stripe + producto — 5 min

1. Entra a [stripe.com](https://stripe.com), crea cuenta. Empieza en **modo test**.
2. **Productos → Añadir producto**:
   - Nombre: `Ordy Chat Pro`
   - Precio: `19.90 EUR`, recurrente mensual
   - Guardar → copia el `price_...` ID
3. **Developers → API keys**: copia `sk_test_...`
4. **Developers → Webhooks → Add endpoint**:
   - URL: `https://TU-DOMINIO-VERCEL.vercel.app/api/stripe/webhook` (la sabrás en el paso 5)
   - Eventos: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`
   - Copia el `whsec_...` del webhook
5. Te quedan: `STRIPE_SECRET_KEY=sk_test_...`, `STRIPE_PRICE_ID=price_...`, `STRIPE_WEBHOOK_SECRET=whsec_...`

---

## 4. Anthropic API key — 2 min

1. Entra a [platform.anthropic.com](https://platform.anthropic.com).
2. **Settings → API Keys → Create Key**.
3. Guarda: `ANTHROPIC_API_KEY=sk-ant-...`

---

## 5. Deploy `web/` a Vercel — 10 min

1. Entra a [vercel.com/new](https://vercel.com/new).
2. Importa el repo `Bonets-grill/ordy-chat`.
3. **Root Directory** = `web`
4. Framework preset: Next.js (auto-detectado)
5. **Environment variables** (copia de `SECRETS-GENERATED.txt` + las que acabas de crear):
   ```
   DATABASE_URL=postgresql://neondb_owner:...@...neon.tech/neondb?sslmode=require
   AUTH_SECRET=<del archivo>
   AUTH_URL=https://TU-APP.vercel.app
   AUTH_RESEND_KEY=re_...
   AUTH_EMAIL_FROM=noreply@tu-dominio.com
   ANTHROPIC_API_KEY=sk-ant-...
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   STRIPE_PRICE_ID=price_...
   ENCRYPTION_KEY=<del archivo>
   RUNTIME_URL=https://TU-RUNTIME.up.railway.app  (aún no lo tienes — lo pones en el paso 6)
   RUNTIME_INTERNAL_SECRET=<del archivo>
   SUPER_ADMIN_EMAIL=mtmbdeals@gmail.com
   NEXT_PUBLIC_APP_URL=https://TU-APP.vercel.app
   ```
6. **Deploy**. En 2 min tienes la URL pública.
7. Copia la URL y actualiza `AUTH_URL` y `NEXT_PUBLIC_APP_URL` con el dominio final.
8. Vuelve al webhook de Stripe y actualiza su URL con `https://TU-APP.vercel.app/api/stripe/webhook`.

---

## 6. Deploy `runtime/` a Railway — 8 min

1. Entra a [railway.app/new](https://railway.app/new).
2. **Deploy from GitHub** → selecciona `Bonets-grill/ordy-chat`.
3. **Settings → Root Directory** = `runtime`
4. **Variables** (copia las mismas que en Vercel excepto las propias del web):
   ```
   DATABASE_URL=postgresql://...
   ENCRYPTION_KEY=<mismo que Vercel — debe coincidir>
   ANTHROPIC_API_KEY=sk-ant-...
   ENVIRONMENT=production
   PORT=8000
   ```
5. **Deploy**. Railway te da una URL tipo `ordychat-runtime.up.railway.app`.
6. Vuelve a Vercel → Variables → actualiza `RUNTIME_URL` con la nueva URL.

⚠️ **Importante:** `ENCRYPTION_KEY` debe ser **idéntica** en Vercel y Railway, porque web cifra y runtime descifra las credenciales de tenants.

---

## 7. Primer registro + ascender a super admin

1. Abre `https://TU-APP.vercel.app`
2. Entra con el email configurado en `SUPER_ADMIN_EMAIL` (`mtmbdeals@gmail.com`).
3. Recibes magic link → abres → quedas logueado.
4. El callback de Auth.js detecta que tu email coincide con `SUPER_ADMIN_EMAIL` y te asigna `role='super_admin'` automáticamente.
5. Ya puedes entrar a `/admin`.

Si el automatismo falla por cualquier motivo, puedes forzarlo manualmente:

```bash
cd /Users/lifeonmotus/Projects/ordy-chat
npx tsx scripts/create-super-admin.ts mtmbdeals@gmail.com
```

---

## 8. Prueba end-to-end

1. Crea un segundo user (otro email) y pasa por el wizard. Elige Whapi como proveedor (lo más rápido).
2. En Whapi.cloud, configura el webhook:
   `https://TU-RUNTIME.up.railway.app/webhook/whapi/<slug-del-negocio>`
3. Mándale un mensaje al número Whapi → el agente responde.
4. Vuelve al dashboard → verás la conversación en vivo.
5. Entra a `/admin` con tu email super admin → verás el tenant listado.

---

## Migraciones futuras

Cuando cambies el schema Drizzle:

```bash
cd web
pnpm db:generate   # crea migración en drizzle/
pnpm db:push       # aplica a Neon
```

Ambos commands usan `DATABASE_URL` de `.env.local`.

---

## Problemas comunes

| Problema | Arreglo |
|---|---|
| Vercel build falla con `PNPM_LOCK_NOT_FOUND` | Local: `cd web && pnpm install` y sube `pnpm-lock.yaml` |
| Magic link no llega | Verifica dominio en Resend. Revisa spam. |
| Stripe webhook falla con `Invalid signature` | Comprueba que `STRIPE_WEBHOOK_SECRET` en Vercel = el `whsec_...` del endpoint |
| Runtime no arranca en Railway | Ver logs. Suele ser `ENCRYPTION_KEY` ausente o `DATABASE_URL` mal copiada |
| Agent no responde | `/admin/tenants` → ver tenant → ¿`onboardingCompleted=true`? ¿`subscription_status` en `trialing`/`active`? |
