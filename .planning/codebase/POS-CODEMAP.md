# Ordy Chat — Codemap POS / Paneles tenant + super-admin

**Snapshot**: 2026-04-25 commit `709dc4d` (post Mig 054 + Promptfoo evals).
**Propósito**: orientar la reorganización Apple-style sin tocar nada antes de mapear.

## 1. Topología de paneles

```
ordychat.ordysuite.com/
├── /admin/*            → Super admin (role=super_admin) — multi-tenant
├── /dashboard/*        → Tenant admin (owner / tenant_admin) — config & reporting
├── /agent/*            → Tenant operativa (waiter/manager/staff) — runtime
├── /m/[slug]           → Cliente final público (QR mesa) — no-auth
├── /c/[slug]           → Comandero kiosk auth con PIN — no session web
└── /agent/comandero    → Comandero dentro de auth web del owner
```

## 2. Páginas existentes (con responsabilidad)

### 2.1 `/admin/*` — Super Admin (plataforma)

| Path | Archivo | Función | Estado |
|---|---|---|---|
| `/admin` | `app/admin/page.tsx` | Landing super admin | ✅ existe pero sin overview cockpit |
| `/admin/tenants` | `app/admin/tenants/page.tsx` | Lista tenants | ✅ tabla básica, falta health/MRR |
| `/admin/tenants/[id]` | `app/admin/tenants/[id]/page.tsx` | Detalle tenant | ✅ |
| `/admin/instances` | `app/admin/instances/page.tsx` | Instancias WA Evolution | ✅ |
| `/admin/onboarding-jobs` | `app/admin/onboarding-jobs/page.tsx` | Jobs onboarding fast | ✅ |
| `/admin/payouts` | `app/admin/payouts/page.tsx` | Payouts resellers | ✅ |
| `/admin/resellers` | `app/admin/resellers/page.tsx` | Lista resellers | ✅ |
| `/admin/flags` | `app/admin/flags/page.tsx` | Feature flags | ✅ |
| `/admin/settings` | `app/admin/settings/page.tsx` | Platform settings (API keys cifradas) | ✅ |
| `/admin/learning` | `app/admin/learning/page.tsx` | Auto-learning cron logs | ✅ |
| `/admin/validator` | `app/admin/validator/page.tsx` | Validator del bot | ✅ |
| `/admin/assistant` | `app/admin/assistant/page.tsx` | Asistente Opus 4.7 | ✅ |

**GAP super-admin**: NO HAY un dashboard cockpit con MRR/tenants activos/pedidos hoy/health en una vista. Cada tab es aislado.

### 2.2 `/dashboard/*` — Tenant config (owner web)

| Path | Archivo | Función |
|---|---|---|
| `/dashboard` | `app/dashboard/page.tsx` | Resumen (Mig 046) |
| `/dashboard/carta` | `app/dashboard/carta/page.tsx` | Editor carta + modifiers + alérgenos |
| `/dashboard/modificadores` | `app/dashboard/modificadores/page.tsx` | Biblioteca modifiers (Mig 051) |
| `/dashboard/alergenos` | `app/dashboard/alergenos/page.tsx` | Biblioteca alérgenos (Mig 051) |
| `/dashboard/recomendaciones` | `app/dashboard/recomendaciones/page.tsx` | Items recomendados + upsell flags |
| `/dashboard/playground` | `app/dashboard/playground/page.tsx` | Test del bot en sandbox |
| `/dashboard/turno` | `app/dashboard/turno/page.tsx` | Apertura/cierre turno POS (Mig 040) |
| `/dashboard/ventas` | `app/dashboard/ventas/page.tsx` | Reportes POS (filtra is_test=false) + tabs horas/pareto/productos/meseros/propinas |
| `/dashboard/tpv` | `app/dashboard/tpv/page.tsx` | Stripe Terminal config |

### 2.3 `/agent/*` — Tenant operativa

| Path | Archivo | Función |
|---|---|---|
| `/agent` | `app/agent/page.tsx` | Mi agente (config bot) |
| `/agent/comandero` | `app/agent/comandero/page.tsx` | Mesero toma pedidos + cobra mesas (POS principal) |
| `/agent/kds` | `app/agent/kds/page.tsx` | KDS cocina/bar |
| `/agent/kds/kiosk` | `app/agent/kds/kiosk/page.tsx` | KDS modo kiosk fullscreen |
| `/agent/tables` | `app/agent/tables/page.tsx` | Mesas y QRs |
| `/agent/tables/plano` | `app/agent/tables/plano/page.tsx` | Plano visual mesas |
| `/agent/empleados` | `app/agent/empleados/page.tsx` | Gestión empleados PIN (Mig 049) |
| `/agent/reservations` | `app/agent/reservations/page.tsx` | Reservas |
| `/agent/closed-days` | `app/agent/closed-days/page.tsx` | Días cerrados |
| `/agent/suppliers` | `app/agent/suppliers/page.tsx` | Proveedores |
| `/agent/fiscal` | `app/agent/fiscal/page.tsx` | Datos fiscales |
| `/agent/knowledge` | `app/agent/knowledge/page.tsx` | Conocimiento bot (RAG ligero) |
| `/agent/security` | `app/agent/security/page.tsx` | TOTP 2FA (Mig 047) |
| `/agent/reportes-pos` | `app/agent/reportes-pos/page.tsx` | Reportes WA POS (cron) |

## 3. APIs principales del POS

### 3.1 Comandero (mesero)
- `GET /api/comandero/menu` — carta canónica ES con modifiers via biblioteca (Mig 051)
- `POST /api/comandero/orders` — crea pedido desde mesero
- `GET /api/comandero/tables` — lista mesas con estado open/closed
- `POST /api/comandero/tables/[number]/close` — cierra mesa con discount/tip (Mig 054)
- `GET /api/comandero/tables/[number]/ticket` — cuenta detallada (Mig 054)
- `POST /api/comandero/login` — PIN auth
- `POST /api/comandero/logout`

### 3.2 Tenant config
- `/api/tenant/menu/*` — CRUD items + modifiers (legacy + nuevo via biblioteca)
- `/api/tenant/modifier-groups/*` — biblioteca grupos (Mig 051)
- `/api/tenant/allergens/*` — biblioteca alérgenos (Mig 051)
- `/api/tenant/tables/*` — mesas + plano
- `/api/tenant/playground` — test sandbox

### 3.3 Admin
- `/api/admin/settings` — API keys plataforma
- `/api/admin/resellers/*` — gestión resellers
- `/api/admin/payouts/*` — payouts
- `/api/admin/assistant` — Opus 4.7 chat super admin

## 4. Sidebar actual (`components/app-shell.tsx`)

Agrupación actual (3 grupos):
- **Operación**: Resumen, Conversaciones, Playground, Mi agente, Conocimiento
- **Restaurante**: Carta, Modificadores, Alérgenos, Recomendaciones, Mesas y QRs, Comandero, Empleados, KDS, Reservas, Días cerrados, Proveedores, TPV
- **Cuenta**: Datos fiscales, Ventas y reportes, Reportes POS WA, Facturación

Total: **20 items** en sidebar tenant. Sin badges, sin search, sin shortcuts.

## 5. Mesa workflow actual (POS comandero)

Estado mesa:
- `free` (verde) → click → abre menú para crear pedido
- `occupied` (ámbar) → click → abre POSView con cuenta + descuento + propina + cobrar (Mig 054)
- POSView NO tiene split bill (única función POS class-world ausente)

Datos POS persistidos:
- `orders.subtotal_cents`, `tax_cents`, `total_cents`
- `orders.tip_cents` (Mig 041), `discount_cents` (Mig 054)
- `orders.payment_method`, `paid_at`
- `table_sessions` (Mig 032) — sesión activa por mesa
- `shifts` (Mig 040) — turno POS

## 6. KDS actual (`/agent/kds`)

Cards por pedido con:
- Tipo (dine_in/takeaway), mesa, items
- Estados: pending_kitchen_review → preparing → ready → served → paid
- Acciones: Aceptar (con ETA), Rechazar (con razón)
- Toggle "Incluir pruebas" (Mig 029) para ver is_test=true

**GAP KDS**: no hay vista cocina vs bar separada, no hay timer visual del tiempo transcurrido por orden, no hay drag para reordenar.

## 7. Estructura `components/`

```
components/
├── app-shell.tsx           ← Sidebar tenant (a refactorizar F5)
├── notifications-bell.tsx
├── ui/                     ← shadcn/ui base
└── (no hay /admin shell separado — admin reusa app-shell)
```

## 8. Lo que NO existe (gaps confirmados)

- ❌ Split bill (dividir cuenta entre N comensales con items distintos)
- ❌ Course management (entrantes → principal → postre con timing cocina)
- ❌ Inventario (más allá de stock_qty básico Mig 044)
- ❌ Customer profiles persistentes con historial pedidos
- ❌ Loyalty program / fidelización
- ❌ Reservation depósitos / pre-payment
- ❌ Online ordering nativo (solo via WA actualmente)
- ❌ Delivery integration (Glovo / Uber Eats / Just Eat)
- ❌ Kitchen printer support
- ❌ Cash drawer integration
- ❌ Receipt printing
- ❌ Multi-location (solo single-location por tenant)
- ❌ Employee scheduling / shifts
- ❌ Time clock empleados
- ❌ Recipe / cost management (food cost %)
- ❌ Modifier dependencies UI (configurar depends_on_option_id desde dashboard) — solo SQL ahora
- ❌ Reorganizar items (drag-drop sort_order desde UI carta)
- ❌ Super-admin overview cockpit con MRR/health/pedidos hoy
- ❌ Sidebar search-jump
- ❌ Sidebar badges con counts en vivo
- ❌ Dark mode KDS
- ❌ Apple-grade typography + spacing system

## 9. Decisiones técnicas heredadas (NO romper)

- Driver Neon HTTP — NO `db.transaction()` (commit `1e6dc88` + `24ac805`)
- ALS multi-tenant pattern — todas las queries con `tenant_id`
- `is_test` flag (Mig 029) — KDS toggle, Ventas excluye, workers WA skipean
- `locked` archivos en `LOCKS/` (si existen) — verificar antes de tocar
- Commits firmados (Ed25519, key `~/.dilo-learn-keys` no aplica aquí, este repo usa `gpgsign=true` per CLAUDE.md)
- Comentarios y nombres de variables en español cuando ayudan al dominio

## 10. Files que se tocarán (lista anticipada por fase)

| Fase | Files a tocar | Files a crear |
|---|---|---|
| F4 split | `web/app/agent/comandero/comandero-board.tsx`, `web/app/api/comandero/tables/[n]/close/route.ts`, `web/lib/db/schema.ts` | `shared/migrations/055_split_bill.sql`, `web/app/api/comandero/tables/[n]/split/route.ts` |
| F5 sidebar | `web/components/app-shell.tsx` | (eventualmente `components/admin-shell.tsx` si separamos) |
| F6 super-admin | `web/app/admin/page.tsx`, `web/app/api/admin/...` (nueva ruta overview) | `web/app/api/admin/overview/route.ts`, `web/app/admin/_overview-card.tsx` |
| F7 polish | `web/app/agent/comandero/comandero-board.tsx`, `web/app/agent/kds/kds-board.tsx`, `web/components/app-shell.tsx`, posiblemente `web/tailwind.config.ts` | (no crea, refina) |

## 11. Riesgos identificados

- **Sidebar**: el refactor de `app-shell.tsx` afecta TODAS las páginas autenticadas. Riesgo si rompe layout en alguna. Mitigación: typecheck + smoke manual de cada page.
- **Split bill** sobre `db.transaction` ya removido — split debe seguir el mismo patrón de operaciones independientes con cleanup vía cron.
- **Super-admin overview** necesita queries multi-tenant rápidas — usar índices existentes.
- **Apple-style** sin perder accesibilidad — mantener focus rings, contrast WCAG AA.
