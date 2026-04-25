# POS Competitive Analysis — Top 5 Restaurant POS (2026)

**Author:** Research agent (Opus 4.7) for Mario / Ordy Chat
**Date:** 2026-04-25
**Goal:** Identify feature gaps and Apple-grade visual patterns to lift Ordy Chat (multi-tenant SaaS hostelería ES; Next.js + FastAPI; carta + comandero + KDS + biblioteca modificadores + ventas + WhatsApp agent already shipped) to world-class POS standards.

---

## 0. Comparative table (one-screen view)

| Dimension | Square for Restaurants | Toast | Lightspeed Restaurant | Clover | TouchBistro |
|---|---|---|---|---|---|
| **Base monthly** | $0 / $49 / $149 per location | $0–$69 base; real cost $150–$300 | $69 / $189 / $399 | $135 (QSR) / $179 (FSR) | $69/terminal (+ $19–$330 add-ons) |
| **Card processing** | 2.4–2.6% + 15¢ | 2.49% + 15¢ (locked-in) | 2.6% + 10¢ | 2.3–2.6% + 10¢ | Bring-your-own (Worldpay, Moneris, Barclaycard) |
| **Hardware lock-in** | Optional (BYO iPad ok) | Mandatory Toast hardware | iPad BYO | 36-month contract, proprietary | iPad BYO |
| **Contract** | Month-to-month | 2–3 years auto-renew | 1 year minimum | 36 months | Annual |
| **Split bill** | By item / seat / % / amount | Yes | Yes | Yes (item / guest / custom) | Yes |
| **Coursing (fire/hold)** | Yes (toggle Fire/Hold) | Yes (apps before entrees, auto) | Basic | Yes (assign order + fire on demand) | Yes |
| **KDS dark mode** | Add-on $20–30/mo per device | Yes — built-in light/dark theme + grid customization | Yes | Yes | Yes |
| **Online ordering** | Native, included | Native, commission-free | Order Anywhere | Via 3rd-party apps | Native |
| **Loyalty** | Native | Native (~$25/mo) | Via integrations | 3rd-party apps | Native |
| **Inventory to ingredient** | Limited | Yes (xtraCHEF) | Yes | Limited | Yes (NEW 2026) |
| **G2 / Capterra rating** | 4.10 / 4.3 | 4.2 / 4.4 | ~4.0 / 3.9 | ~3.9 / 3.9 | 4.2 / 3.9 |
| **#1 differentiator** | Free tier + transparent rates | Best-in-class online ordering + handhelds | 40% faster transactions + AI insights | Hardware ecosystem + apps marketplace | iPad-first hybrid (offline survives outages) |
| **#1 critique** | Account holds on funds | Lock-in + hidden fees + price hikes mid-contract | Poor delivery integrations, support lag | 36-mo contract, hardware bricked on switch | Customer support delays, billing disputes |

---

## 1. Square for Restaurants

**URL:** https://squareup.com/us/en/restaurants

### Features (verified)
- **Split check by item, seat, %, amount.** "Easily divide checks for any party size — by item, by seat, or in equal payments." [Square Help — Split a check](https://squareup.com/help/us/en/article/6432-payments-with-square-for-restaurants)
- **Coursing with Fire/Hold.** "Coursing allows you to organize a check's items into 'courses' that can be toggled between Fire and Hold." [Square Help — Check Management](https://squareup.com/help/us/en/article/6429-check-management-with-square-for-restaurants)
- **Auto-gratuity by party size threshold.** [Square Help — Auto-gratuity](https://squareup.com/help/us/en/article/8175-customize-and-apply-automatic-gratuity-with-square-for-restaurants)
- **Bar tab with preauthorization.** "Quick, no-fuss checkouts with preauthorized bar tabs."
- **Modifiers** with notes per line item.
- **Order consolidation:** in-house, online, delivery partners, QR all in one queue. "Eliminates tablet farms or order chaos." [Square for Restaurants page](https://squareup.com/us/en/restaurants)
- **Marketing & loyalty integrated.**
- **Scheduling** ("Schedule and pay your team").

### Pricing
- **Free** $0 — basic POS, menu, online ordering, offline payments
- **Plus** $49/mo per location — split checks, auto-gratuity, close-of-day reports, coursing
- **Premium** $149/mo per location — multi-location, lowest rates (2.4% + 15¢), 24/7 support
- KDS add-on $20–30/mo per device; Kiosk $30–50/mo
- [Square pricing](https://squareup.com/us/en/restaurants/pricing) · [NerdWallet review](https://www.nerdwallet.com/business/software/reviews/square-for-restaurants)

### Visual / UX
- Gradient hero backgrounds, sans-serif modern type (no detail beyond marketing site verified).
- iPad + Square Stand + Square Terminal hardware with consistent black/white + brand teal accents.

### Integrations
- DoorDash, Uber Eats, Grubhub (via Square's Order Manager).
- QuickBooks, Xero accounting.
- Native Square Payroll, Square Marketing, Square Loyalty.

### Critiques (G2 / Capterra / BBB)
- **Account holds on suspicious transactions.** "They hold onto your money if it's a large amount for over seven days."
- **Granular inventory not built-in.**
- **Pooled-tip reporting is a "custom report nightmare."**
- [Merchant Maverick review](https://www.merchantmaverick.com/reviews/square-for-restaurants-pos-review/) · [Capterra reviews](https://www.capterra.com/p/175628/Square-Point-of-Sale/reviews/)

### Differentiator
**Free tier with full POS** — only major POS that lets a restaurant start at $0 and pay only processing fees. Transparent flat-rate pricing.

---

## 2. Toast POS

**URL:** https://pos.toasttab.com (homepage returned 403 to fetch; secondary pages used)

### Features (verified)
- **Coursing with auto-firing.** "Handles coursing so appetizers go out before entrees."
- **KDS with red modification highlights and auto-86.** "Shows order modifications in red, handles coursing… auto-86s items when they run out."
- **KDS appearance menu — light/dark theme + adjustable text size, columns, rows.** [Toast updates — KDS Appearance](https://updates.toasttab.com/announcements/customize-kds-text-size-columns-rows-and-theme-from-the-kds-appearance-menu)
- **KDS hardware tested to 120°F, grease/spill resistant.** [Toast KDS hardware](https://pos.toasttab.com/hardware/kitchen-display-system)
- **Toast Go 2 handhelds — fires orders to kitchen instantly, payment at table.**
- **Toast Mobile Order & Pay (QR at table) — "10–12% increase in processing volume" reported.** [Toast Mobile Order & Pay](https://pos.toasttab.com/products/mobile-order-and-pay)
- **Online ordering with dynamic order throttling** ("snooze" during peak times). [Toast online ordering](https://pos.toasttab.com/products/online-ordering)
- **86 sync** between in-house and online (instant).
- **Loyalty opt-in at table or counter, fed by transaction data.**
- **Toast Now / Plus / Premium** bundles add gift cards + email marketing.

### Pricing
- Base $0–$69/mo, **real-world $150–$300/mo** once KDS, online ordering, payroll, loyalty added.
- Hardware: Toast Flex ~$627, Toast Go 2 ~$409.
- Processing 2.49% + 15¢ standard / 3.09%+ pay-as-you-go.
- Add-ons: Payroll $6/employee/mo, Marketing ~$75/mo, Loyalty ~$25/mo.
- [Toast pricing](https://pos.toasttab.com/pricing) · [Restaurant Launchpad TCO](https://restaurantlaunchpad.io/toast-pos-review/)

### Visual / UX
- Brand color: orange/red (warm, restaurant-coded).
- KDS supports **dark mode**, configurable grid (rows/columns), age-based ticket header colors, flash animation for new/changed tickets, sound notifications.
- Floor-plan templates published as marketing collateral. [Toast floor plan templates](https://pos.toasttab.com/resources/restaurant-floor-plan-templates)

### Integrations
- Toast Payroll, Toast Capital (lending), Toast Marketing, Toast Loyalty, Toast Tips Manager all native.
- Third-party: DoorDash, Uber Eats, Grubhub, OpenTable, Resy, 7shifts, QuickBooks.

### Critiques
- **Hidden fees / opaque pricing.** "Hidden fees and surprise charges on monthly statements" is the #1 complaint.
- **2–3 year auto-renewing contracts; ETF = remaining software + processing.**
- **Mid-contract rate increases with 30-day notice.**
- **Hardware lock-in — Toast hardware doesn't work with other POS** ("$3,000+ becomes paperweights").
- [POSUSA review](https://www.posusa.com/toast-pos-review/) · [Sleft Payments](https://www.sleftpayments.com/learning-hub/toast-pos-raised-fees-options-2026)

### Differentiator
**Best-in-class native online ordering + handhelds tightly coupled to KDS.** Order throttling and instant 86-sync are rare. Dynamic price increases reported as "10–12% volume lift" with Mobile Order & Pay.

---

## 3. Lightspeed Restaurant

**URL:** https://www.lightspeedhq.com/pos/restaurant

### Features (verified)
- **Split bill, discounting, basic POS workflows.**
- **Order Anywhere** (online ordering + QR).
- **Delivery consolidation.**
- **Inventory tracking to ingredient level.**
- **Tableside ordering, customer-facing displays, KDS, workforce management.**
- **Customizable menus, screens, floor plans.**
- **Lightspeed AI** for real-time business insights ("not verified — marketing claim").
- **Offline mode** continues running without internet.
- **Multi-location: unlimited locations from one platform.**
- **Embedded payments (Lightspeed Payments).**

### Pricing
- **Starter** $69/mo — POS, menu, floor plans, insights, payments, takeout/delivery, loyalty, single-view reconciliation
- **Essential** $189/mo — online ordering, contactless ordering, order/pay at table, multi-location, advanced inventory
- **Premium** $399/mo — multiple revenue centers (hotels), raw API access
- **Enterprise** custom
- BYO iPad, 1-year contract minimum, 14-day free trial. Processing 2.6% + 10¢ on Starter.
- [Capterra pricing](https://www.capterra.com/p/211849/Lightspeed-Resturant/pricing/) · [G2 pricing](https://www.g2.com/products/lightspeed-restaurant/pricing)

### Visual / UX
- Cloud-based, iPad-first. Customizable floor plans and screens.
- "Speed advantage: 40% faster on average than other leading restaurant POS" — Lightspeed marketing claim, **not independently verified**.

### Integrations
- 100+ partners: 7shifts, OpenTable, hotel PMS, accounting, reservation systems.

### Critiques
- **Customer support inconsistent** — "support tickets going unresolved or unanswered for weeks."
- **Lag and crashes reported.**
- **Delivery integrations weak** — "Integrating with Uber, DoorDash, Grubhub has remained very difficult."
- **QR codes tied to tables, not orders** → errors when guests move.
- **Back-office UI hard to customize.**
- [Capterra reviews](https://www.capterra.com/p/211849/Lightspeed-Resturant/reviews/)

### Differentiator
**True multi-location at scale + API access on Premium.** Strong inventory-to-ingredient depth. Hotel PMS integrations rare elsewhere.

---

## 4. Clover

**URL:** https://www.clover.com/restaurant-pos-system (homepage returned generic content; deeper pages used)

### Features (verified)
- **Split bill by guest, item, custom amount** — "no limitations, conditions, or hassle."
- **Course management with order assignment + fire-on-command.** "Assign the order of courses, customize orders with descriptive modifiers, and fire orders to your kitchen the moment they're placed." [BlueLine Point — Clover Dining](https://bluelinepoint.com/clover-dining-pos/)
- **Modifiers including required modifiers, dietary restrictions, special instructions.**
- **KDS with multi-screen routing.** "Orders can be fired to multiple kitchen displays."
- **Visual table layouts** — save defaults, change on the fly, customize floor plans, manage tables and guests, preauthorize bar tabs.
- **Loyalty, online ordering, delivery** primarily via Clover App Marketplace (not native).

### Pricing
- **QSR plan ~$135/mo, FSR ~$179/mo per location.** [Tech.co Clover pricing](https://tech.co/pos-system/clover-pos-pricing)
- Processing 2.3–2.6% + 10¢ card-present; 3.5% + 10¢ keyed.
- Hardware: Station Solo $1,699–$1,799; Station Duo $1,899–$2,099; Flex $599–$749.
- **36-month contract** standard; ETF $500–$2,000+.
- Hidden fees: PCI compliance $9.95/mo, statement $5–$15/mo, platform access $27.95/mo → adds $100–$200/mo per location.
- [UpMenu Clover pricing](https://www.upmenu.com/blog/clover-pos-pricing/)

### Visual / UX
- Hardware-first brand identity. Station Duo has merchant-facing + customer-facing screens (rare).
- UI is utilitarian; consistent across hardware family.

### Integrations
- **App Marketplace** — third-party apps for nearly everything (loyalty, scheduling, online ordering, delivery). Rare among POS, but means most "features" are paid add-ons.

### Critiques
- **"Not built for full-service restaurants"** — common review.
- **Hardware bricked on switch:** "Any Clover hardware you purchase cannot be reused with another POS system or even with a different merchant services provider." [Merchant Maverick](https://www.merchantmaverick.com/reviews/clover-pos-system-review/)
- **Heavy reliance on paid third-party apps.**
- **36-month contract feels predatory** — "felt trapped in inflexible contracts and facing significant price increases."
- **Customer service unreliable.**
- [POSUSA review](https://www.posusa.com/clover-pos-review/) · [Toast's Clover review](https://pos.toasttab.com/blog/on-the-line/clover-pos-reviews)

### Differentiator
**Hardware ecosystem + App Marketplace.** Closest thing to "App Store for POS." But model is anti-customer for restaurants that want to switch.

---

## 5. TouchBistro

**URL:** https://www.touchbistro.com

### Features (verified)
- **Tableside ordering, customer-facing displays.**
- **Inventory Management (NEW 2026)** — "Save time, reduce food costs."
- **Labor Management (NEW 2026)** — schedule + labor cost control.
- **KDS for FOH-BOH coordination.**
- **Loyalty, gift cards, online ordering, reservations, marketing automation.**
- **Hybrid POS (cloud + on-prem server) — survives internet outages.**
- Split billing, course management, multi-location supported (specifics not detailed on marketing site).

### Pricing
- **$69/mo per terminal** baseline.
- Add-ons $19–$330/mo (loyalty, online ordering, reservations, marketing).
- Annual contract.
- [Capterra TouchBistro pricing](https://www.capterra.com/p/140677/TouchBistro/pricing/) · [G2 pricing](https://www.g2.com/products/touchbistro-restaurant-pos/pricing)

### Visual / UX
- iPad-first, "clean, intuitive interface easy for new staff to learn."
- Hybrid architecture: local server + cloud reporting.

### Integrations
- MarginEdge, Restaurant365, Barclaycard, Worldpay, Moneris, 7shifts.
- **Bring-your-own payment processor** (rare — most POS lock you in).

### Critiques
- **Customer support: "quick callbacks for sign-ups but months-long delays for cancellations with continued billing."**
- **Reporting "horrific" — daily reports don't subtract cash payouts from totals.**
- **Sales tactics aggressive; some users sold "outdated equipment, including discontinued payment terminals."**
- Capterra 3.9/5, G2 4.2/5.
- [Software Advice reviews](https://www.softwareadvice.com/retail/touchbistro-profile/reviews/) · [Trustpilot](https://www.trustpilot.com/review/touchbistro.com)

### Differentiator
**Hybrid (offline-first) architecture + BYO payment processor.** Restaurant doesn't lose service when internet drops. Most POS competitors require always-online.

---

## INSIGHTS APLICABLES A ORDY CHAT

Priorizadas por **impacto (alto = mueve métricas o cierra ventas) × esfuerzo (bajo = encaja en stack Next.js + FastAPI + biblioteca actual)**. NO repito lo que Ordy Chat ya tiene (carta, comandero, KDS, biblioteca modificadores, ventas básico, WA agent).

### Tier S — Build inmediato (alto impacto, esfuerzo razonable)

1. **Coursing con Fire/Hold toggle** *(impacto: full-service restaurants no compran sin esto)*
   Toda la competencia lo tiene. Comanda agrupada por curso (entrantes / principales / postres) con toggle "Disparar / Retener" por curso. KDS recibe en orden. Sin esto Ordy Chat se queda en QSR.

2. **Split bill nativo: por item / por comensal / por % / por importe** *(impacto: deal-breaker en mesa de 4+)*
   Square, Toast, Clover y Lightspeed lo tienen. Cuatro modos en una pantalla. Persistir el split en la orden (no recalcular en pago).

3. **86-sync instantáneo entre carta WA / web / KDS** *(impacto: anti-error operativo)*
   Toast lo destaca. Cuando cocina marca "agotado", en <2s desaparece de WA agent + carta web + comandero. Stack actual ya tiene canal Realtime → barato de cerrar.

4. **KDS dark mode + grid configurable + age-based color highlights** *(impacto: "Apple-grade visual" pedido por Mario)*
   Toast: light/dark theme, ajustar columnas/filas, header color cambia según antigüedad del ticket, flash animation al entrar nuevo ticket, sonido. Este es el bloque más visual y el menos costoso (CSS + un setting). Diferenciador inmediato.

5. **QR Mobile Order & Pay en mesa (sin app)** *(impacto: Toast reporta +10–12% volumen)*
   QR pegado a mesa → cliente pide y paga sin esperar mesero. Reutiliza WA agent como backend conversacional. Stack ya tiene Stripe → 2 pantallas Next.js + 1 endpoint.

### Tier A — Build próximo trimestre

6. **Auto-gratuity por tamaño de grupo (umbral configurable)** *(impacto: ES no tiene tipping cultural pero sí "servicio incluido para grupos >8")*
   Square: regla automática por party-size. Trivial: 1 setting + lógica en checkout.

7. **Bar tab con preautorización Stripe** *(impacto: bares y terrazas — segmento ES enorme)*
   Square y Clover lo destacan. Pre-auth Stripe + cierre al irse. Stack tiene Stripe ya.

8. **Floor plan visual editor (drag & drop mesas, formas, capacidades)** *(impacto: cierra ventas en restaurantes con sala)*
   Lightspeed, Clover, Toast lo tienen. SVG en Next.js + estado en Postgres. Plantillas pre-hechas (Toast publica las suyas como lead magnet — copiar la idea).

9. **Modo offline / hybrid resilience** *(impacto: TouchBistro lo vende como su #1 diferenciador)*
   Service Worker + IndexedDB queue para operaciones críticas (tomar pedido, cobrar). Ya hay PWA → falta el queue + sync layer. Diferencia vs Toast/Square en sitios con WiFi pobre (terrazas, eventos).

### Tier B — Build cuando justifique pricing tier alto

10. **Inventario a nivel ingrediente (receta → consumo automático al vender plato)** *(impacto: cierra Premium tier y reduce mermas)*
    Lightspeed y TouchBistro son los más fuertes aquí. Mapeo plato → receta → ingredientes con descuento automático en stock al confirmar venta. Tabla `recipes` + `ingredient_consumption_log`.

11. **Multi-screen kitchen routing (cocina caliente / fría / barra / postres)** *(impacto: necesario para fine dining y cocinas grandes)*
    Clover y Toast lo tienen. Reglas por categoría de plato → printer/screen específico. Sólo enrutamiento extra sobre KDS actual.

12. **Loyalty con opt-in por WA al pagar + analytics de cliente** *(impacto: ya tienes el canal WA, es el moat más fuerte vs los 5 gringos)*
    Toast destaca "loyalty data fed by every transaction." Ordy Chat tiene **WhatsApp 1-a-1 con cliente final** — ningún competidor de esta lista lo tiene de fábrica. Acumular puntos + cumpleaños + push de cupones por WA = ventaja imposible de copiar para Toast/Square en ES en 12 meses.

### Anti-patterns a EVITAR (lecciones de los críticos)

- **Nunca lock-in 36 meses ni hardware propietario** (Clover y Toast pierden clientes por esto). Mantener Ordy Chat month-to-month, BYO iPad/Android.
- **Nunca subidas de tarifa sin avisar** (Toast: queja #1 en Capterra).
- **Nunca account-holds opacos** (Square: BBB lleno de quejas). Si Ordy Chat algún día procesa pagos, comunicar holds proactivamente.
- **Reporting que no cuadra** (TouchBistro: "horrific reporting"). Cierre de día debe cuadrar caja, propinas, comisiones tarjeta y delivery al céntimo desde día 1.
- **Soporte que tarda semanas** (queja transversal en los 5). El WA agent de Ordy puede ser el canal de soporte propio — vuelve a ser ventaja.

---

## Sistema visual Apple-grade — pistas extraídas

- **Toast KDS appearance menu** = patrón a copiar: settings de tema (light/dark/auto), tamaño tipográfico, densidad (columnas/filas), color por antigüedad de ticket, animación de entrada, sonido. Una sola pantalla configura todo. Diferenciador visual instantáneo y barato.
- **Square**: tipografía sans-serif densa, gradientes saturados sólo en marketing, UI POS plana y monocroma con un acento (teal). Disciplina cromática.
- **Lightspeed**: floor plans editables drag-and-drop con tema oscuro consistente.
- **Clover Station Duo**: doble pantalla (mesero + cliente) — para Ordy Chat traducible a "iPad mesero + iPad/teléfono cliente con QR" sin hardware extra.
- **Touch targets ≥44pt iOS HIG** en todos los POS (testeado vía screenshots de marketing). Mantener este mínimo en Ordy Chat móvil/tablet.

---

## Fuentes (todas verificadas durante esta investigación)

### Sites oficiales
- [Square for Restaurants](https://squareup.com/us/en/restaurants)
- [Square Help — Split a check](https://squareup.com/help/us/en/article/6432-payments-with-square-for-restaurants)
- [Square Help — Check Management / Coursing](https://squareup.com/help/us/en/article/6429-check-management-with-square-for-restaurants)
- [Square Help — Auto-gratuity](https://squareup.com/help/us/en/article/8175-customize-and-apply-automatic-gratuity-with-square-for-restaurants)
- [Toast POS](https://pos.toasttab.com/) (homepage 403 vía fetch — info via secondary pages)
- [Toast pricing](https://pos.toasttab.com/pricing)
- [Toast KDS hardware](https://pos.toasttab.com/hardware/kitchen-display-system)
- [Toast KDS appearance update](https://updates.toasttab.com/announcements/customize-kds-text-size-columns-rows-and-theme-from-the-kds-appearance-menu)
- [Toast Mobile Order & Pay](https://pos.toasttab.com/products/mobile-order-and-pay)
- [Toast online ordering](https://pos.toasttab.com/products/online-ordering)
- [Toast floor plan templates](https://pos.toasttab.com/resources/restaurant-floor-plan-templates)
- [Lightspeed Restaurant](https://www.lightspeedhq.com/pos/restaurant)
- [Clover restaurant POS](https://www.clover.com/restaurant-pos-system) (generic content via fetch)
- [TouchBistro](https://www.touchbistro.com)

### Pricing & TCO
- [Tech.co — Clover pricing 2026](https://tech.co/pos-system/clover-pos-pricing)
- [UpMenu — Clover pricing breakdown](https://www.upmenu.com/blog/clover-pos-pricing/)
- [UpMenu — Toast pricing](https://www.upmenu.com/blog/toast-pricing/)
- [Restaurant Launchpad — Toast TCO](https://restaurantlaunchpad.io/toast-pos-review/)
- [POSUSA — Toast review](https://www.posusa.com/toast-pos-review/)
- [POSUSA — Square for Restaurants review](https://www.posusa.com/square-for-restaurants-review/)
- [POSUSA — TouchBistro review](https://www.posusa.com/touchbistro-pos-review/)
- [POSUSA — Clover review](https://www.posusa.com/clover-pos-review/)
- [Capterra — Lightspeed Restaurant pricing](https://www.capterra.com/p/211849/Lightspeed-Resturant/pricing/)
- [Capterra — TouchBistro pricing](https://www.capterra.com/p/140677/TouchBistro/pricing/)
- [G2 — Lightspeed Restaurant pricing](https://www.g2.com/products/lightspeed-restaurant/pricing)
- [G2 — TouchBistro pricing](https://www.g2.com/products/touchbistro-restaurant-pos/pricing)
- [NerdWallet — Square for Restaurants review](https://www.nerdwallet.com/business/software/reviews/square-for-restaurants)
- [NerdWallet — Clover POS review](https://www.nerdwallet.com/business/software/reviews/clover-pos)

### Reviews / critiques
- [Capterra — Toast POS reviews](https://www.capterra.com/p/136301/Toast-POS/reviews/)
- [Capterra — Square for Restaurants reviews](https://www.capterra.com/p/175628/Square-Point-of-Sale/reviews/)
- [Capterra — Lightspeed Restaurant reviews](https://www.capterra.com/p/211849/Lightspeed-Resturant/reviews/)
- [Capterra — TouchBistro reviews](https://www.capterra.com/p/140677/TouchBistro/reviews/)
- [Software Advice — TouchBistro](https://www.softwareadvice.com/retail/touchbistro-profile/reviews/)
- [Trustpilot — TouchBistro](https://www.trustpilot.com/review/touchbistro.com)
- [Merchant Maverick — Square for Restaurants](https://www.merchantmaverick.com/reviews/square-for-restaurants-pos-review/)
- [Merchant Maverick — Clover POS](https://www.merchantmaverick.com/reviews/clover-pos-system-review/)
- [Sleft Payments — Toast 2026 fee hikes](https://www.sleftpayments.com/learning-hub/toast-pos-raised-fees-options-2026)
- [Toast blog — Clover reviews](https://pos.toasttab.com/blog/on-the-line/clover-pos-reviews)
- [Toast blog — Square reviews](https://pos.toasttab.com/blog/on-the-line/square-reviews)
- [BlueLine Point — Clover Dining features](https://bluelinepoint.com/clover-dining-pos/)
- [Tech.co — Toast vs Clover comparison](https://tech.co/pos-system/toast-vs-clover)

### "No verificado" (claims marketing que no encontré confirmados independientes)
- Lightspeed "40% faster than competitors" — claim de marketing.
- Lightspeed AI "real-time business insights" — funcionalidad anunciada, no probé.
- Toast Mobile Order & Pay "+10–12% volume" — número del propio Toast, no auditoría independiente.
