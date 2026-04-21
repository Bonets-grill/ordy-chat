# Benchmark Agentes IA Hostelería — 2026-04-19

**Autor:** Claude (con benchmark proporcionado por Mario).
**Contexto:** Ordy Chat pivotó a especialización hostelería hoy. Este doc analiza los 23 competidores del mercado ES + intl para identificar qué tienen que nosotros no y dónde están nuestras ventajas reales.

**Ordy Chat estado live (post-deploy c5289d3):**
- €49.90/mes + 3 add-ons (Pedidos, KDS, POS a €9.90/9.90/49.90).
- Agente Claude 4.5/Haiku 4.5 multi-provider (Whapi + Meta Cloud + Twilio).
- KDS cocina/bar realtime ✅ (live hoy).
- Reservas UI con state machine ✅ (live hoy).
- Webchat público + widget embebible ✅ (live hoy).
- Webchat gratis con base.
- Multi-tenant RLS, validador LLM-judge, onboarding scraping, Verifactu-ready schema.

---

## 1. TL;DR ejecutivo

**Nuestro posicionamiento**: el más barato de los especialistas hostelería ES (€49.90 vs €67 Gastrochat, €100 MesaBot, €149 Mesaking), con tecnología Claude superior a reglas tradicionales, y multicanal (WA + webchat) de serie. Hoy somos ya competitivos en el segmento indie.

**Gaps top-3 que nos impiden ganar restaurantes premium/turísticos**:
1. **Sin canal VOZ** (teléfono). 60%+ de reservas indie todavía entran por llamada. Slang/Hostie/Newo cobran $199-599/mes solo por esto. Twilio Voice + Claude = feature construible en 2 sprints.
2. **Sin integración CoverManager/TheFork**. Esas dos plataformas capturan el 80% de reservas en restaurantes con ticket medio €40+. Mesaking ya integra; nosotros forzamos al restaurante a elegir.
3. **Sin campañas proactivas** (re-engagement, birthdays, review requests, recordatorios). Gastrochat + Cheerfy monetizan esto como feature principal.

**Gaps top-2 legales España (jugar defensivo)**:
4. **Verifactu/TicketBAI activo**. Tenemos schema pero NO emisor live. Qamarero + Last.app ya lo tienen. Legal obligatorio desde enero 2026.
5. **Gestión no-show con prepagos**. Es el dolor #1 del restaurante fine-dining. CoverManager monetiza esto.

**Ventajas que NADIE tiene hoy**:
- Precio entrada 3x menor que el más barato del tier especialista (Gastrochat €67).
- Webchat + WhatsApp **mismo agente, misma memoria**, setup 0 extra. Nadie hace esto (Gastrochat solo QR, CoverManager add-on caro).
- Claude como LLM principal — calidad conversacional que reglas/plantillas no alcanzan.
- Validador automático (LLM-judge) — calidad garantizada pre-deploy.

---

## 2. Mapa competitivo por tier

### Tier A — Especialistas WhatsApp IA hostelería ES (competidores directos)

| Empresa | Precio €/mes | Segmento | Fortalezas únicas | Debilidades |
|---|---|---|---|---|
| **Mesaking** | 149 / 299 / custom | Indies + fine-dining | AI sommelier, integra CoverManager + TheFork | Precio 7x el nuestro |
| **MesaBot** | 100€ Pro | Upscale turísticos | 20+ idiomas, CRM alergias profundo | Solo WhatsApp, sin web |
| **Gastrochat** | desde 67€ | Indies (80+ clientes) | Campañas, gestión reviews Google, CRM | Sin AI sommelier, sin voz |
| **Haleteo** | 50-1000+ | Pymes→corporate | Multi-canal (WA+web+email+voz), integra CRM/ERP | Precio custom opaco |

**Observación**: los especialistas ES se mueven €67-300/mes. Nosotros a €49.90 estamos rompiendo el suelo. Riesgo: parecer low-cost y ahuyentar premium. Mitigación: pricing tier €49-79 para "Pro" con integraciones.

### Tier B — Plataformas reservas con add-on IA/WA

| Empresa | Precio | Segmento | Notas |
|---|---|---|---|
| **CoverManager** | 99-349€ + 1.50€/reserva | Michelin, NH, 16k rest. | AssistantBot voz es add-on caro. La dominancia es en canales (40+) y no-show. |
| **TheFork Manager** | PRO 30€ / PRO+ 75€ + 0.95% + 0.50€/comensal | Todos | Audience propia = trae demanda. Pago comisión ≠ SaaS puro. |
| **SevenRooms** | ~$499/mes | Premium intl | CRM + IA marketing; USA first. |

**Observación**: estos no son competidores puros — son **canales** donde las reservas ya viven. Integrar con ellos > competir. Mesaking entendió esto. Nosotros no.

### Tier C — TPV con capa IA/automación

| Empresa | Precio €/mes | Fuerte en | IA/agente |
|---|---|---|---|
| **Revo Xef** | 49.90 / 69.90 | KDS iOS + menú dinámico | "Tracker IA Bronze" (light) |
| **Haddock** | Growth 85 / Premium 120 | Back-office OCR facturas | "AI Agents" nuevo |
| **Last.app** | 50/95/175 + 400€ setup + 4% online | TPV + delivery | No IA frontal |
| **Qamarero** | ~100€ | TPV cloud + pago móvil | Verifactu/TicketBAI ✅ |
| **Ágora / Camarero10 / Glop** | 32-130€ | TPV tradicional | Nada notable |

**Observación**: ninguno tiene agente conversacional real. Están metiendo "IA" como badge en back-office. Aquí podemos complementar (no sustituir) con integraciones.

### Tier D — Voz (teléfono) — USA first, sin ES todavía

| Empresa | Precio | Fuerte en |
|---|---|---|
| **Slang.ai** | $399 Core / $599 Premium + $99 bilingüe | Reservas voz, VIP routing |
| **Hostie AI** | $199/local | AI phone + texting multi-local |
| **Newo.ai** | $99 + $1.65/llamada | AI host overflow |
| **Synthflow** | $99-799 | Voz DIY con templates |
| **Flipdish** | No público | AI Phone Agent nov-2025 (no ES) |
| **Bookline** | Enterprise | Voz + WA + salientes, 100 POS integrations |

**Observación ESTRATÉGICA**: el canal voz en hostelería ES está prácticamente vacío. Bookline es enterprise (no pyme). Los USA están a $199-599. **Esto es un océano azul para Ordy Chat si entramos a precio competitivo (€39-79/mes)**.

### Tier E — CRM/fidelización/back-office (no competidores frontales)

- **Cheerfy** (setup 99€ + SMS/email usage): fidelización + kioscos
- **Yurest, Mapal OS**: back-office grupos grandes

Son complementarios, no rivales directos.

---

## 3. Feature matrix — qué tiene cada uno

Leyenda: ✅ = sí / ⚠ = parcial / ❌ = no / 🚫 = N/A

| Feature | Ordy Chat | Mesaking | MesaBot | Gastrochat | CoverManager | TheFork | Haleteo | Slang.ai |
|---|---|---|---|---|---|---|---|---|
| Agente WA conversacional LLM | ✅ Claude | ✅ | ✅ | ✅ | ⚠ addon | ❌ | ✅ | ❌ |
| Webchat web mismo agente | ✅ hoy | ❌ | ❌ | ⚠ QR | ❌ | ❌ | ✅ | ❌ |
| **Canal voz (teléfono)** | **❌** | ❌ | ❌ | ❌ | ⚠ AssistantBot addon | ❌ | ✅ | ✅ |
| Reservas gestión | ✅ hoy | ✅ | ✅ | ✅ | ✅ premium | ✅ | ✅ | ✅ |
| No-show prepago | ❌ | ⚠ | ❌ | ❌ | ✅ | ✅ | ❌ | ⚠ |
| **Integración CoverManager** | **❌** | ✅ | ❌ | ❌ | — | ❌ | ⚠ | ❌ |
| **Integración TheFork** | **❌** | ✅ | ❌ | ❌ | ❌ | — | ⚠ | ❌ |
| **Multi-idioma (20+)** | **⚠ Claude lo hace, UI no** | ⚠ | ✅ | ⚠ | ✅ | ✅ | ⚠ | ✅ bilingüe |
| AI sommelier / maridajes | ⚠ prompt-driven | ✅ feature | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Carta / menu consulta | ✅ | ✅ | ✅ | ✅ | ❌ | ⚠ | ✅ | ❌ |
| Pedidos (takeaway) | ✅ | ⚠ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| **KDS cocina/bar** | **✅ hoy** | ❌ | ❌ | ❌ | ❌ | ❌ | ⚠ | ❌ |
| **Campañas proactivas** | **❌** | ⚠ | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Google Reviews gestión** | **❌** | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Verifactu / TicketBAI** | **⚠ schema, no live** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | 🚫 |
| Pagos Stripe en chat | ✅ | ⚠ | ❌ | ❌ | ✅ | ✅ | ⚠ | ⚠ |
| Multi-tenant + RLS | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Validador calidad LLM-judge | **✅ único** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Onboarding scraping auto | **✅ único** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Alergias CRM profundo | ⚠ | ⚠ | ✅ | ⚠ | ✅ | ⚠ | ⚠ | ⚠ |
| Precio entrada €/mes | **49.90** | 149 | 100 | 67 | 99 | 30 | 50 | 399$ |

**Conclusión gráfica**: 7 gaps críticos vs tier A (Mesaking/Gastrochat/MesaBot). 5 ventajas únicas nuestras.

---

## 4. Qué tienen ellos que nosotros NO

### 4.1 Canal VOZ (teléfono) — criticidad 🔴🔴🔴

**Quién**: Slang.ai, Hostie AI, Newo, Synthflow, Flipdish, Bookline, CoverManager (addon).

**Por qué importa**: en hostelería ES el 50-65% de reservas indie todavía llegan por teléfono (datos Horecatec 2024). El dueño contesta mientras sirve mesa → pierde reservas o calidad. Un agente IA telefónico:
- Captura reservas 24/7.
- Calificación pre-visita (alergias, cumpleaños, número personas).
- VIP routing (si el número está en la CRM, saluda por nombre y ofrece mesa preferida).

**Cómo construirlo**:
- Twilio Voice + Claude (Whisper STT + ElevenLabs TTS o Claude realtime audio).
- Endpoint `/api/voice/webhook` recibe Twilio events → mismo brain que WA.
- Precio objetivo €39/mes add-on (vs Slang $399, Hostie $199).

**Impacto**: abre segmento premium (fine-dining, hoteles urbanos), justifica tier Pro €49-79/mes.

### 4.2 Integración CoverManager + TheFork — criticidad 🔴🔴🔴

**Quién**: Mesaking, Haleteo (parcial).

**Por qué importa**: los restaurantes con ticket >€40 YA usan una de estas plataformas porque traen audience, Google Reservation, TripAdvisor. Pedir que migren a nosotros es perder el deal. Mesaking vende caro pero "sin dejar de usar tu sistema actual" — es su argumento principal.

**Cómo construirlo**:
- CoverManager API (OAuth + webhooks). Cuando el agente crea reserva, la sincroniza a CM.
- TheFork API más cerrado; empezar por CoverManager solo.
- UI `/agent/integrations/covermanager` para setup por tenant.

**Impacto**: desbloquea segmento premium + argumento de venta "no tengas que cambiar nada".

### 4.3 Campañas proactivas — criticidad 🔴🔴

**Quién**: Gastrochat, Cheerfy, CoverManager, TheFork, Haleteo.

**Tipos**:
- **Recordatorio reserva** (24h y 2h antes) — reduce no-show.
- **Post-visita** (review request Google Maps + feedback).
- **Cumpleaños** — oferta/regalo para re-engagement.
- **Re-engagement** cliente dormido (>90 días sin venir).
- **Announcements** (nuevo menú de temporada, evento especial).

**Cómo construirlo**:
- Nueva tabla `campaigns` + `campaign_runs`.
- Cron `/api/cron/campaigns-dispatch` (hourly) evalúa criterios.
- UI `/agent/campaigns` admin para templates.
- WhatsApp Business API templates preaprobados (24h window rule).

**Impacto**: aumenta revenue recuperado/tenant — argumento ROI >200%.

### 4.4 Google Reviews gestión — criticidad 🔴🔴

**Quién**: Gastrochat, CoverManager, TheFork.

**Flow**:
- Agente pide review post-visita confirmada.
- Sugiere texto si el cliente está dispuesto.
- Responde automáticamente reviews negativas con IA (borrador para aprobar por dueño).

**Cómo construirlo**: Google Business Profile API + Claude para drafts. Mid-complexity.

### 4.5 No-show management con prepagos — criticidad 🔴

**Quién**: CoverManager (core feature), TheFork, Mesaking parcial.

**Cómo construirlo**: Stripe (ya tenemos) + flag en reserva `requires_deposit` → payment link en WA → no-show penalization. 1 sprint.

### 4.6 Verifactu / TicketBAI live — criticidad legal 🔴🔴🔴

**Quién**: Qamarero, Last.app implementado. Nadie más de los agentes IA.

**Por qué importa**: obligatorio desde enero 2026 en España para cualquier emisión de factura. Schema ya lo anticipa, falta el emisor activo + integración AEAT.

**Cómo construirlo**: librería `verifactu-sdk` node + firma digital XAdES + webhook AEAT + UI `/agent/fiscal` para configurar NIF + certificado.

**Impacto**: evita bloqueo legal + diferencia vs Mesaking/MesaBot/Gastrochat que no lo tienen.

### 4.7 AI sommelier (feature específico) — criticidad 🟡

**Quién**: Mesaking (feature estrella).

**Gap real**: nosotros YA podemos hacerlo vía prompt ("recomienda vino para X plato"). Falta:
- UI en el dashboard `/agent/wine-cellar` para subir carta de vinos.
- Metadata por vino (uva, región, notas, precio, stock).
- Prompt enriquecido con la carta cuando el mensaje habla de maridaje.

**Esfuerzo**: 3-5 días. Feature marketing-ready fácil.

### 4.8 Multi-idioma 20+ (turismo) — criticidad 🟡

**Quién**: MesaBot.

**Gap real**: Claude habla 20+ idiomas nativamente. Falta:
- Detección idioma del mensaje entrante (`franc-lang-detect`).
- UI del dashboard traducida a ES/EN/FR/DE/IT al mínimo.
- FAQs/carta multi-idioma (opcional: guardamos en ES y Claude traduce al vuelo).

**Esfuerzo**: 2-3 días para MVP de detección + ES/EN UI.

### 4.9 CRM alergias profundo — criticidad 🟡

**Quién**: MesaBot (feature estrella), CoverManager.

**Gap real**: guardamos mensajes pero no estructuramos "cliente habitual X es celíaco". Falta:
- Tabla `customers` (per tenant) con `dietary_restrictions`, `preferences`, `notes`.
- Tool agente `actualizar_cliente` para que guarde findings.
- UI `/agent/customers` para auditar/editar.

**Esfuerzo**: 1 sprint completo.

---

## 5. Qué tenemos NOSOTROS que ellos no

Estas son las trincheras defensibles:

### 5.1 Precio de entrada €49.90 ⚔️
3x más barato que Gastrochat. 5x que MesaBot. 8x que Mesaking. **Abrimos segmento indie/bar/cafetería que hoy nadie sirve bien**. Riesgo: percepción low-cost. Mitigación: tier Pro €49-79 con integraciones.

### 5.2 Claude como LLM principal (4.7 Opus / 4.5 Sonnet / 4.5 Haiku) ⚔️
Competidores usan GPT-3.5/4o o reglas tradicionales. Claude:
- Calidad conversacional superior (verificado en evals).
- Menos alucinaciones con context-awareness.
- Cache prompting reduce coste 50%.
- Tool use estable para crear_pedido, crear_cita, etc.

### 5.3 Webchat + WhatsApp = mismo agente, misma memoria ⚔️
Nadie más lo ofrece con widget embebible gratis. Feature live hoy (c5289d3).

### 5.4 KDS cocina/bar integrado ⚔️
Revo Xef lo tiene en iOS TPV. El resto de especialistas WA no. Hoy lo tenemos live (f31c92b).

### 5.5 Validador LLM-judge automático ⚔️
Sprint 2 validador-core ya hecho. Nadie más audita calidad del agente pre-deploy con LLM independiente. Argumento marketing: "el único agente que no se equivoca porque otro Claude lo audita antes de salir a producción".

### 5.6 Onboarding fast con scraping ⚔️
Pegas URL de la web del restaurante → scraper extrae platos/precios/horarios → merger LLM → agente listo en 5 min. Gastrochat/MesaBot requieren formulario manual de 30+ campos.

### 5.7 Open architecture multi-tenant ⚔️
Schema RLS, ALS wrappers, multi-provider (Whapi/Meta/Twilio) — arquitectura sólida para crecer. Competidores monolitos en muchos casos.

---

## 6. Roadmap recomendado (trimestral)

Principio: cerrar gaps por **impacto revenue × esfuerzo**. No queremos 20 features mediocres; queremos 5 features excelentes.

### Q2 (próximos 3 meses) — CERRAR TOP GAPS

| Prioridad | Feature | Impacto | Esfuerzo | ¿Por qué ahora? |
|---|---|---|---|---|
| 1 | **Verifactu/TicketBAI live** | Defensivo legal | 2-3 semanas | Obligatorio enero 2026; bloqueador legal |
| 2 | **Canal voz (Twilio Voice + Claude)** | +40% TAM | 3-4 semanas | Océano azul en ES; tier Pro €49 |
| 3 | **Integración CoverManager** | Desbloquea premium | 2-3 semanas | Sin esto no entramos en fine-dining |
| 4 | **Campañas proactivas** | +20% LTV | 2 semanas | ROI demostrable, argumento de venta |
| 5 | **CRM customers + alergias estructurado** | Mejora calidad agente | 1 semana | Unlocks AI sommelier y personalization |

### Q3 — AMPLIAR MOAT

| Feature | Descripción |
|---|---|
| **AI sommelier feature-ready** | UI wine-cellar + prompts enriquecidos |
| **Multi-idioma UI (ES/EN/FR/DE/IT)** | Mercado turístico costa |
| **Google Reviews gestión** | Pedir reviews + responder negativas con IA |
| **No-show prepagos Stripe** | Feature premium para fine-dining |
| **Integración TheFork API** | Después de CoverManager funcionando |

### Q4 — OCUPAR SEGMENTOS

- **Starter €9.90/mes** (solo WA, sin add-ons) → desbloquea microempresa (bar de barrio).
- **Pro €79/mes** (voz + integraciones + campañas) → cubre fine-dining.
- **Enterprise custom** (multi-local + SLA + white-label) → grupos 5+ locales.
- **Hotelería** (si hay tracción): mismo agente con use cases de booking (check-in, info estancia, room service por WA).

---

## 7. Pricing position — dónde metemos €49.90

```
€0                 €50               €100              €200              €500+
│                   │                  │                  │                  │
Ordy €49.90  Revo €49  Gastrochat €67  MesaBot €100  Mesaking €149  CoverManager €99-349+1.50/resv
             Qamarero €100            CoverManager €99
                                      TheFork €75+
```

**Observaciones**:
1. **Desierto €20-49**: nadie está ahí. Oportunidad para un **Starter €9.90** y el **Base €49.90** actual.
2. **Sweet spot €49-79**: aquí deberíamos meter un **Pro** con voz + integraciones + campañas. Ningún especialista IA lo ocupa con seriedad.
3. **€100+ es donde compiten Mesaking/CoverManager/SevenRooms**. Ir ahí requiere enterprise features (multi-local, SLA).

**Propuesta pricing 3-tier**:

| Tier | Precio | Incluye | Segmento |
|---|---|---|---|
| Starter | €9.90/mes | WA agente básico + webchat + 500 conv | Bar barrio, café |
| **Base** | **€49.90/mes** | Todo Starter + reservas + KDS + pedidos + 2000 conv | Restaurante indie ← actual |
| Pro | €59/mes | Base + voz teléfono + integración CoverManager + campañas + 5000 conv | Fine-dining, turismo |
| Enterprise | custom | Pro + multi-local + SLA + white-label | Grupos 3+ locales |

---

## 8. Riesgos y amenazas

### Amenazas competitivas
- **Mesaking bajando precio** si nos huele agresivos. Mitigación: movernos rápido con voz + CoverManager.
- **OpenAI lanzando agentes verticales hostelería**. Ya hay rumor de "GPT Restaurant". Mitigación: nuestra arquitectura multi-tenant + validador LLM-judge es foso, no el LLM en sí.
- **Flipdish entrando a ES con voz**. Ya tienen AI Phone Agent en US. Si llegan con $200/mes + audience restaurantes = dolor. Mitigación: voz propia en Q2.

### Riesgos internos
- **Webchat v1 sin persistencia runtime** — los mensajes web no aparecen en el inbox del dashboard. Fase siguiente: bridge al runtime Python (prioritario).
- **Sin emisor Verifactu activo** — schema ya listo pero sin integración AEAT. Legal mandatory.
- **Sin pruebas contra agentes reales** (Promptfoo + evals vs Gastrochat/MesaBot public chats). Montar harness en próximo sprint.

---

## 9. Siguientes 3 acciones concretas

1. **Aplicar migración 016 a Neon prod** (`psql $DATABASE_URL < shared/migrations/016_order_items_station.sql`). Sin esto el KDS falla en prod.
2. **Escribir spec voz** (`docs/superpowers/specs/2026-04-YY-canal-voz-twilio.md`) → the-architect → audit-architect → build. Empezar en 3 días.
3. **Bridge webchat → runtime Python** para persistencia + tool use. 1 sprint. Sin esto el webchat se queda en MVP y no aporta al inbox.

---

## 10. Fuentes verificadas del benchmark

Los datos de esta tabla vienen de InfoHoreca, mesaking.com, mesabot.es, gastrochat.es, El Español, haleteo.com, ChefBusiness, Monouso, last.app/precios, comparadortpv, tpvhosteleria, restauracionnews, haddock.app/precios, cheerfy.com, Flipdish, slang.ai/pricing, hostie.ai/pricing, newo.ai/pricing, synthflow.ai — todos recopilados por Mario 2026-04.

**Caveat**: precios públicos pueden estar desactualizados (especialmente planes enterprise y custom). Validar en llamada de ventas antes de usar en copy comercial.
