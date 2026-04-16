# CLAUDE.md — Ordy Chat

Guía para Claude Code al trabajar en este repo.

## Qué es este proyecto

Ordy Chat es un **SaaS multi-tenant** (€19.90/mes) que deja a cualquier negocio tener su propio agente de WhatsApp con IA. El onboarding ya NO es por CLI de Claude Code — se hace desde la web.

## Estructura

- `web/` — Next.js 15 App Router. Landing pública, dashboard del tenant, panel super admin, API routes.
- `runtime/` — FastAPI Python. Recibe webhooks de WhatsApp, resuelve el tenant, llama a Claude, responde.
- `shared/` — tipos/constantes comunes (si aplica).
- `scripts/` — utilidades de mantenimiento.

Todo se persiste en **Neon Postgres** (project `empty-block-73744049`). Drizzle en `web/` y asyncpg en `runtime/` escriben contra el MISMO schema — respetar la fuente de verdad.

## Reglas al trabajar aquí

1. **Español en toda comunicación y código.** Comentarios y nombres de variables en español cuando ayuden a entender el dominio.
2. **Multi-tenant siempre.** Ninguna query sin `tenant_id` (excepto tablas globales: `users`, `platform_settings`).
3. **Ningún secreto en código.** Credenciales de tenants en `provider_credentials.credentials_encrypted` (AES-256-GCM con `ENCRYPTION_KEY`). Claves globales en `platform_settings` también cifradas.
4. **Edits quirúrgicos.** El stack está definido: no introducir ORMs, frameworks ni abstracciones nuevas sin pedirlo.
5. **El super admin se identifica por `users.role = 'super_admin'`.** El email en `SUPER_ADMIN_EMAIL` obtiene el rol al primer registro.
6. **El runtime nunca confía en el webhook:** valida el `tenant_id` resolviendo por `phone_number_id` (Meta), `token` (Whapi) o `AccountSid` (Twilio).
7. **Nunca invocar `pip install` sin venv.** Python local está protegido (PEP 668). En `runtime/` hay `.venv`.

## Stack de referencia

| Capa | Tecnología |
|------|------------|
| Web framework | Next.js 15 (App Router, RSC por defecto) |
| Lenguaje web | TypeScript estricto |
| Styling | Tailwind v3 + shadcn/ui |
| ORM | Drizzle |
| Auth | Auth.js v5 (email magic link vía Resend) |
| DB | Neon Postgres (serverless, `@neondatabase/serverless`) |
| Billing | Stripe Checkout + Webhook |
| Runtime agente | FastAPI + Anthropic SDK + asyncpg |
| Deploy | Vercel (web) · Railway (runtime) |

## Schema DB (resumen)

- `users` (role: `super_admin` | `tenant_admin`), `accounts`, `sessions`, `verification_tokens` — Auth.js
- `tenants` (slug, subscription_status, stripe_*, trial_ends_at)
- `tenant_members` — membresía user↔tenant
- `agent_configs` — system_prompt, tono, horario, use_cases (reemplaza `prompts.yaml`)
- `provider_credentials` — Whapi/Meta/Twilio cifradas
- `conversations`, `messages` — historial (reemplaza `memory.py` SQLite)
- `platform_settings` — claves globales cifradas (super admin)
- `audit_log` — auditoría

Detalle exacto en `shared/schema.sql` o en `web/lib/db/schema.ts`.

## API keys que Claude NO puede poner

El owner las pega en el Super Admin o en `.env`:

- `ANTHROPIC_API_KEY` — hay que sacarla de platform.anthropic.com
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID` — desde dashboard Stripe
- `AUTH_RESEND_KEY` — desde Resend
- Credenciales de Whapi/Meta/Twilio — las pone cada tenant en su onboarding

## Comandos útiles

```bash
# Web
cd web && pnpm dev                 # dev server
cd web && pnpm db:push             # sync schema con Neon
cd web && pnpm db:studio           # Drizzle Studio

# Runtime
cd runtime && uvicorn app.main:app --reload --port 8000

# Crear super admin manualmente
pnpm tsx scripts/create-super-admin.ts email@ejemplo.com
```
