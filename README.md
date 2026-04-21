# Ordy Chat

**Plataforma SaaS multi-tenant para que cualquier negocio tenga su agente de WhatsApp con IA en 5 minutos.**

€49.90/mes · 7 días de prueba gratis · Funciona en cualquier nicho.

---

## Qué es Ordy Chat

Un negocio se registra, responde unas preguntas en una UI tipo chat, conecta su número de WhatsApp y en minutos tiene un agente con IA que atiende a sus clientes 24/7.

- **Multi-tenant:** cada negocio es un `tenant` con su propia configuración, credenciales y conversaciones aisladas.
- **Multi-nicho:** no está atado a un vertical. El system prompt se genera dinámicamente a partir de lo que el dueño del negocio cuenta.
- **Multi-proveedor:** Whapi.cloud, Meta Cloud API o Twilio — el tenant elige cuál conectar.
- **Super Admin:** panel interno donde el owner de la plataforma configura las claves globales (Anthropic, Stripe) y ve todos los tenants.

---

## Arquitectura

```
ordy-chat/
├── web/                ← Next.js 15 (landing + app + super admin)
│   ├── app/
│   │   ├── (marketing)/      Landing pública tipo Softr
│   │   ├── (app)/            Dashboard del tenant (auth required)
│   │   ├── (admin)/          Super admin (role='super_admin')
│   │   └── api/              Routes: auth, onboarding, stripe, webhook-proxy
│   ├── lib/                  Drizzle, Auth.js, Stripe, crypto
│   └── components/
│
├── runtime/            ← FastAPI Python (webhook handler multi-tenant)
│   ├── app/
│   │   ├── main.py           Webhook /webhook/{provider}/{tenant_slug}
│   │   ├── brain.py          Claude API — lee system_prompt desde DB
│   │   ├── memory.py         Conversaciones en Postgres
│   │   ├── tenants.py        Resolver por phone / credenciales
│   │   └── providers/        whapi, meta, twilio
│   ├── requirements.txt
│   └── Dockerfile
│
├── shared/             ← Tipos/constantes que ambos lados comparten
└── scripts/            ← Utilidades (crear super admin, etc.)
```

**Flujo de un mensaje entrante:**

```
WhatsApp → Proveedor (Whapi/Meta/Twilio) → webhook → runtime/
  → resolve tenant_id por phone_number_id
  → carga agent_config + historial desde Postgres
  → Claude API (system_prompt del tenant)
  → guarda mensaje + respuesta
  → envía respuesta por el mismo proveedor
```

## Stack

- **Web:** Next.js 15 (App Router) · Tailwind · shadcn/ui · Auth.js v5 · Drizzle ORM
- **DB:** Neon Postgres (pooled, serverless)
- **Runtime agente:** FastAPI · Anthropic SDK · asyncpg
- **Billing:** Stripe Checkout + Webhooks
- **Deploy:** Vercel (web) + Railway (runtime)

---

## Setup local

```bash
git clone https://github.com/Bonets-grill/ordy-chat.git
cd ordy-chat
cp .env.example .env
# rellena DATABASE_URL, AUTH_SECRET, ANTHROPIC_API_KEY, STRIPE_*, ENCRYPTION_KEY

# Web
cd web
pnpm install
pnpm db:push
pnpm dev

# Runtime (otra terminal)
cd runtime
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Abre `http://localhost:3000`. Registrate con el email en `SUPER_ADMIN_EMAIL` y tendrás acceso a `/admin`.

---

## Variables de entorno

Ver `.env.example`. Las claves globales (Anthropic, Stripe) se pueden configurar también desde el Super Admin en la UI — se cifran con AES-256-GCM antes de guardarse.

## Licencia

Uso interno — todos los derechos reservados.
