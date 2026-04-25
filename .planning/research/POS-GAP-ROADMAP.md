# Ordy Chat — GAP analysis vs class-world POS + Roadmap priorizado

**Inputs**: `.planning/codebase/POS-CODEMAP.md` + `.planning/research/POS-COMPETITIVE-ANALYSIS.md`
**Date**: 2026-04-25
**Goal**: identificar qué falta vs Square/Toast/Lightspeed/Clover/TouchBistro y priorizar con framework RICE para esta sesión.

## 1. Tabla GAP feature-by-feature

| Feature | Square | Toast | Lightspeed | Clover | TouchBistro | **Ordy Chat** | GAP |
|---|---|---|---|---|---|---|---|
| Modifier groups + opciones | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ Mig 051 biblioteca | ✅ |
| Modifier dependencies (Smash → no cocción) | ⚠ manual | ⚠ manual | ⚠ manual | ⚠ manual | ⚠ manual | ✅ depends_on_option_id Mig 051 | ✅ **diferenciador** |
| Allergens DB | parcial | ✅ xtraCHEF | parcial | parcial | parcial | ✅ Mig 051 biblioteca | ✅ **diferenciador** |
| Menu CRUD + categories | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Open table + acumular pedidos | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ Mig 032 sessions | ✅ |
| **Split bill** by item/seat/%/amount | ✅ 4 modos | ✅ | ✅ | ✅ | ✅ | ❌ NO existe | 🔴 **CRÍTICO** |
| Discount + tip on close | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ Mig 054 | ✅ |
| Auto-gratuity by party size | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | 🟡 |
| Coursing (fire/hold appetizers→main→dessert) | ✅ | ✅ auto | basic | ✅ | ✅ | ❌ | 🟡 |
| KDS dark mode | add-on | ✅ built-in | ✅ | ✅ | ✅ | ❌ solo light | 🟡 |
| KDS ticket-age colors (verde→ámbar→rojo) | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠ solo "29 MIN" texto, sin color | 🟡 |
| KDS station routing (cocina vs bar) | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ una sola vista | 🟡 |
| Kitchen printer | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | 🟢 (digital-first) |
| Cash drawer | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | 🟢 |
| Receipt print/email | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | 🟡 (legal Verifactu requiere) |
| Online ordering nativo | ✅ | ✅ | ✅ | via 3rd party | ✅ | ⚠ solo /m/[slug] widget + WA | ✅ parcial |
| QR mobile order & pay | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ /m/[slug] | ✅ |
| Delivery aggregator integration | ✅ | ✅ Otter | ✅ | via apps | parcial | ❌ | 🟢 |
| **Loyalty program** | ✅ native | ✅ | via int. | apps | ✅ native | ❌ pero tiene canal WA único | 🟢 **moat WA** |
| Customer profile + historial | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠ recordar_cliente tool básico | 🟡 |
| Reservations + deposits | parcial | ✅ | parcial | apps | ✅ | ✅ tool agendar_cita (sin depósito) | ✅ parcial |
| Inventory ingredient-level | ⚠ | ✅ | ✅ | ⚠ | ✅ NEW | ⚠ stock_qty básico Mig 044 | 🟢 |
| Multi-location | Premium | ✅ | ✅ | ✅ | ✅ | ❌ single-location | 🟢 |
| Employee scheduling | Premium | ✅ | ✅ | ✅ | ✅ | ❌ solo PIN Mig 049 | 🟢 |
| Time clock | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | 🟢 |
| Recipe / food cost % | ⚠ | ✅ | ✅ | ⚠ | ✅ | ❌ | 🟢 |
| **Floor plan visual editor** | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠ /agent/tables/plano existe | ✅ parcial |
| Bar tab pre-auth Stripe | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | 🟡 |
| Mode offline (caja sin internet) | ⚠ | ⚠ | parcial | ⚠ | ✅ hybrid | ❌ | 🟢 |
| Multi-tenant SaaS | ❌ single-merchant | ❌ | ❌ | ❌ | ❌ | ✅ Mig 001+ | ✅ **diferenciador** |
| **WhatsApp agent IA nativo** | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ brain + 11 tools | ✅ **MOAT único mundial** |
| Modifier dependencies UI editor | ❌ todos | ❌ | ❌ | ❌ | ❌ | ⚠ DB only, sin UI | 🟡 |
| Super-admin overview cockpit | N/A single-merchant | N/A | N/A | N/A | N/A | ❌ | 🟡 (necesario para SaaS) |
| Sidebar Apple-grade + badges | parcial | ✅ | ✅ | ✅ | ✅ | ⚠ funcional, no Apple-grade | 🟡 |

Leyenda gravedad:
- 🔴 CRÍTICO — bloquea uso pro / pedido explícito de Mario
- 🟡 importante — diferencia pro
- 🟢 nice-to-have — fuera scope sesión

## 2. Priorización RICE

| Feature | Reach | Impact | Confidence | Effort (h) | RICE | Decisión |
|---|---|---|---|---|---|---|
| Split bill (4 modos) | 100% tenants | 5 | 95% | 6 | **79** | **F4 esta sesión** |
| Sidebar Apple-grade + badges | 100% | 4 | 90% | 3 | **120** | **F5 esta sesión** |
| Super-admin overview | 1 user (Mario) | 5 | 95% | 4 | **119** | **F6 esta sesión** |
| KDS dark mode + ticket-age colors | 100% restaurantes | 4 | 90% | 2 | **180** | **F7 esta sesión** |
| Comandero polish Apple-grade | 100% | 3 | 90% | 2 | **135** | **F7 esta sesión** |
| Modifier dependencies UI editor | 30% tenants | 3 | 85% | 3 | **25** | F+1 (1-2 semanas) |
| KDS station routing | 60% | 4 | 80% | 5 | **38** | F+1 |
| Auto-gratuity party-size | 40% | 3 | 80% | 1 | **96** | F+1 (rápida) |
| Coursing fire/hold | 50% | 4 | 70% | 6 | **23** | F+2 |
| Receipt PDF + email Verifactu | 100% (legal) | 5 | 90% | 8 | **56** | F+2 (legal) |
| Loyalty WA-nativo | 100% | 5 | 70% | 12 | **29** | F+3 (moat) |
| Bar tab pre-auth Stripe | 30% | 4 | 70% | 8 | **11** | F+3 |
| Online ordering hub público | 80% | 4 | 80% | 16 | **16** | F+4 |
| Delivery aggregators | 40% | 4 | 50% | 30 | **3** | F+5 (CO complicado) |
| Inventory ingredient-level | 20% | 3 | 70% | 40 | **1** | F+6 |
| Multi-location per tenant | 10% | 3 | 80% | 30 | **0.8** | Backlog |
| Mode offline | 100% | 3 | 50% | 25 | **6** | Backlog |

## 3. Plan de esta sesión (alcance comprometido)

| Fase | Feature | Ya planeado en F? |
|---|---|---|
| F4 | Split bill MVP (4 modos: por item / por comensal / igual / monto) | F4 |
| F5 | Sidebar Apple-grade + badges count en vivo + search | F5 |
| F6 | Super-admin overview cockpit | F6 |
| F7 | KDS dark mode + ticket-age colors + comandero polish | F7 |
| F8 | Audit + reporte | F8 |

**Entregables sesión** (lo que Mario verá tras F8):
- Split bill funcional (la pieza más urgente del POS)
- Sidebar reorganizado, scroll independiente, search-jump, badges en vivo
- Super-admin con cockpit MRR/tenants/pedidos hoy
- KDS dark mode + colores por edad de ticket
- Comandero con tipografía y spacing Apple-grade

**Diferenciadores que ya tienes (NO se tocan, refuerzan moat)**:
- ✅ Multi-tenant SaaS (todos los demás son single-merchant)
- ✅ WhatsApp agent IA nativo (NINGUNO de los 5 lo tiene)
- ✅ Modifier dependencies (Smash skip cocción) — solo Ordy Chat de los 6
- ✅ Allergens biblioteca + i18n cache LLM
- ✅ Mig 029 sandbox is_test (testing sin polución)

**Anti-patterns a evitar** (heredados de research):
- ❌ Lock-in 36 meses (Clover) → Ordy Chat seguirá month-to-month
- ❌ Hardware propietario (Toast) → BYO iPad/cualquier nav
- ❌ Subidas de tarifa sin avisar (Toast) → precio fijo público
- ❌ Account holds opacos (Square) → No procesamos cobros directamente
- ❌ Soporte semanas (TouchBistro) → WA tenant→Ordy support nativo

## 4. Métricas para validar después del cierre

- Comandero: cobrar mesa con split en <90s p95 (clase Toast handheld)
- KDS: tiempo medio aceptación <30s con cards más legibles
- Sidebar: navegar entre secciones <2 clicks (search-jump)
- Super-admin: ver salud de N tenants en 1 vista (vs N tabs hoy)
- Cero regresiones en lo ya shipped (modifier deps, biblioteca, POS Mig 054)
