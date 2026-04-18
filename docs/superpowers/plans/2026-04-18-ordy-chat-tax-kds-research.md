# Ordy Chat — Tax System + KDS + Tax Research Agent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar tres áreas críticas de Ordy Chat en un único plan coherente: (1) sistema fiscal multi-régimen configurable (IVA / IGIC / IPSI / otros) respetando semántica tax-inclusive, (2) KDS (Kitchen Display System) profesional para restaurantes con estado, ETA y notificación WhatsApp al cliente, (3) agente fiscal que busca automáticamente el régimen correcto por país/región.

**Arquitectura:**
- Stream A (Tax) es la base — corrige el bug de cálculo de 17,55 vs 16,40 y desacopla Verifactu (solo IVA) del resto de regímenes. Todos los pedidos posteriores viven sobre esta base limpia.
- Stream B (KDS) consume `orders` ya correctas y añade un workflow de cocina con notificaciones outbound al comensal vía runtime Python (que ya tiene el rate-limit anti-ban y el adapter WhatsApp).
- Stream C (Research Agent) enriquece la UI fiscal permitiendo a un tenant de cualquier país obtener su preset fiscal automáticamente.

**Tech Stack:** Next.js 15 + Drizzle + Neon Postgres (RLS ready-but-dormant) + FastAPI Python runtime + Anthropic Claude (tool use) + Evolution API (WhatsApp) + Stripe Checkout (pagos).

**Gates de seguridad obligatorios en cada task:**
1. Antes del commit: `pnpm tsc --noEmit` debe dar 0 errores (web) + `python -c "from app import main..."` smoke test (runtime).
2. Después del commit: invocar skill `security-review` si la task toca `/api/**`, `stripe`, `auth`, DB schema o input de usuario.
3. Si la task toca schema: verificar en Neon con `SELECT ... FROM information_schema` que los cambios se aplicaron correctamente.
4. Si la task toca una tabla con RLS: confirmar `rowsecurity=true` post-migración.
5. Prohibido `--no-verify`, `--amend`, `git reset --hard` en ramas con trabajo push.

---

## File Map (decisión de descomposición fijada aquí)

### Stream A — Tax System

| Archivo | Responsabilidad |
|---|---|
| `shared/migrations/008_tax_system.sql` (nuevo) | Añade columnas fiscales a `tenants`; renombra `vat_rate`→`tax_rate` en `order_items` y `vat_cents`→`tax_cents` en `orders`; amplía CHECK de `receipts.verifactu_status` con `not_applicable`. |
| `web/lib/tax/presets.ts` (nuevo) | Constantes `TAX_PRESETS` con regímenes conocidos y tasas por defecto (IVA ES, IGIC canarias, IPSI ceuta/melilla). |
| `web/lib/tax/compute.ts` (nuevo) | Función `computeTotals` consciente de `prices_include_tax` (extrae impuesto hacia atrás si PVP ya lo incluye, lo suma encima si es neto). |
| `web/lib/db/schema.ts` (modifica) | Añade campos nuevos en `tenants` + renombra columnas `orderItems.vatRate → taxRate`, `orders.vatCents → taxCents`. |
| `web/lib/orders.ts` (modifica) | Usa `computeTotals` nuevo; elimina el `unitWithVat = unitPriceCents * (1+rate)` de Stripe (pasa PVP tal cual). |
| `web/lib/receipts.ts` (modifica) | Gate `processReceiptForOrder`: si `tax_system != 'IVA'` → `verifactu_status='not_applicable'`. Desglose fiscal usando extracción inversa (base = total / (1+rate)). |
| `web/lib/verifactu/index.ts` (modifica) | Verifica `tenant.tax_system === 'IVA'` antes de encadenar; si no, retorna `skipped`. |
| `web/lib/prompt-builder.ts` (modifica) | Añade sección "Régimen fiscal" al system prompt con tipo de impuesto, tasa y `prices_include_tax`. |
| `web/lib/prompt-regen.ts` (modifica) | Pasa los nuevos campos fiscales del tenant a `buildSystemPrompt`. |
| `web/app/api/fiscal/route.ts` (modifica) | PATCH acepta `taxRegion`, `taxSystem`, `pricesIncludeTax`, `taxRateStandard`, `taxRateAlcohol`. Dropdown valida enum. |
| `web/components/fiscal-panel.tsx` (modifica) | Nueva card "Régimen fiscal" con dropdown regiones + autopreset + edición manual + toggle "los precios ya incluyen impuesto". |
| `runtime/app/brain.py` (modifica) | Description de `crear_pedido.unit_price_cents`: "Precio FINAL al cliente (tal como aparece en el menú, en céntimos)". |
| `web/scripts/migrate-tenant-tax-by-postal-code.ts` (nuevo) | Script one-shot: para cada tenant, si `billing_postal_code` está en rangos 35xxx/38xxx → IGIC; 51xxx/52xxx → IPSI; resto ES → IVA; extranjero → CUSTOM. |
| `web/scripts/delete-test-orders.ts` (nuevo) | Script one-shot: `DELETE FROM orders` (y cascada order_items, receipts) para tenants con slug que empiece por `e2e-`, `cafeteria-e2e-`, `webhook-negocio-`, `pausa-negocio-`, `csv-negocio-`. Confirma antes de ejecutar. |
| `web/tests/unit/tax-compute.test.ts` (nuevo) | Vitest: 10 casos cubriendo IVA/IGIC/IPSI × tax_inclusive/tax_exclusive × 1 item/varios + regresión del bug 16,40→17,55. |

### Stream B — KDS (Kitchen Display System)

| Archivo | Responsabilidad |
|---|---|
| `shared/migrations/009_kds.sql` (nuevo) | Tabla `kitchen_tickets(id, tenant_id, order_id uniq, status, station, eta_at, accepted_at, started_at, ready_at, delivered_at, notes, created_at)` con RLS y tenant_isolation policy. |
| `web/lib/db/schema.ts` (modifica) | Export `kitchenTickets`. |
| `web/lib/kds.ts` (nuevo) | Helpers: `createTicketForOrder(orderId)`, `updateStatus(ticketId, status)`, `setEta(ticketId, minutes)`, `notifyCustomerEta(ticketId)`. |
| `web/app/api/kds/route.ts` (nuevo) | GET: lista tickets activos del tenant (status in pending/accepted/in_progress/ready). Filtros por station. |
| `web/app/api/kds/[id]/route.ts` (nuevo) | PATCH: `status` + `eta_minutes` + `notes`. Idempotente. Dispara notificación al cliente si `eta_minutes` cambia. |
| `web/app/kds/page.tsx` (nuevo) | Server component con auth; renderiza `KdsBoard`. |
| `web/components/kds-board.tsx` (nuevo) | "use client". 4 columnas Kanban (Pendiente · En cocina · Listo · Entregado). Card por ticket con datos del cliente, items, total, botones de transición, input ETA. Polling 3s + sonido al llegar nuevo. |
| `web/components/kds-ticket-card.tsx` (nuevo) | Card aislada: render items + customer + botones acción + campo eta. |
| `web/app/api/stripe/webhook/route.ts` (modifica) | Al `markOrderPaidBySession` exitoso, llama `createTicketForOrder(orderId)`. |
| `web/app/api/orders/route.ts` (modifica) | Cuando una orden se crea con `accept_online_payment=false` (pago en mostrador), crear ticket KDS directamente (sin esperar pago). |
| `web/lib/whatsapp-notify.ts` (nuevo) | Cliente HTTP desde web → runtime `/notify` con `x-internal-secret`. Send text a `{phone}` del tenant correcto. |
| `runtime/app/notify.py` (nuevo) | FastAPI endpoint `/notify`: {tenant_slug, phone, text}; valida `RUNTIME_INTERNAL_SECRET`; resuelve tenant; envía vía adapter; respeta `esperar_turno` anti-ban. |
| `runtime/app/main.py` (modifica) | Registra router `notify.py`. |
| `web/app/layout.tsx` (modifica) | No tocar — KDS tiene su propio layout. |
| `web/tests/unit/kds.test.ts` (nuevo) | Unit tests de transiciones de estado válidas (pending→accepted→in_progress→ready→delivered). |

### Stream C — Tax Research Agent

| Archivo | Responsabilidad |
|---|---|
| `web/lib/tax/research.ts` (nuevo) | Función `researchTaxRegime(country, region?)`: llama a Claude con `WebSearch` tool (Anthropic SDK) + prompt ES/fiscal para devolver `{ system, standard, alcohol, label, sources[] }`. |
| `web/app/api/tax/research/route.ts` (nuevo) | POST endpoint auth-gated: acepta `{country, region?}`, retorna preset sugerido. Rate-limit 5/min por tenant. |
| `web/components/fiscal-panel.tsx` (modifica) | Botón "Buscar régimen fiscal" al lado del dropdown country → spinner → rellena campos. |

---

## Test Strategy (general)

- **Stream A**: mandatory unit tests de `computeTotals` ANTES del commit — regresión del bug de IVA. Integración real contra Neon no aplica (pure function).
- **Stream B**: unit tests del state machine KDS. E2E queda opcional (Playwright si se cuelga).
- **Stream C**: mock de la llamada a Anthropic en test; prod usa API real.

---

## Execution Order

```
Stream A (base)
   ↓
Stream A migración en Neon + script delete test orders (destructivo — ejecutar con CONFIRMACIÓN MANUAL)
   ↓
Stream A script migrate-tenant-tax-by-postal-code (one-shot, incluye bonets-grill-icod → IGIC)
   ↓
Stream B (KDS)
   ↓
Stream C (Research Agent)
```

---

## Stream A — Tax System

### Task A1: Migración de schema fiscal

**Files:**
- Create: `shared/migrations/008_tax_system.sql`
- Verify: Neon via `mcp__Neon__run_sql`

- [ ] **Step 1: Escribir migración SQL**

```sql
-- shared/migrations/008_tax_system.sql

-- tenants: régimen fiscal configurable
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS tax_region TEXT NOT NULL DEFAULT 'es_peninsula'
    CHECK (tax_region IN ('es_peninsula','es_canarias','es_ceuta_melilla','pt','fr','it','de','uk','us','mx','co','ar','cl','pe','other')),
  ADD COLUMN IF NOT EXISTS tax_system TEXT NOT NULL DEFAULT 'IVA'
    CHECK (tax_system IN ('IVA','IGIC','IPSI','VAT','SALES_TAX','GST','NONE','CUSTOM')),
  ADD COLUMN IF NOT EXISTS prices_include_tax BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS tax_rate_standard NUMERIC(5,2) NOT NULL DEFAULT 10.00,
  ADD COLUMN IF NOT EXISTS tax_rate_alcohol  NUMERIC(5,2) NOT NULL DEFAULT 21.00,
  ADD COLUMN IF NOT EXISTS tax_label TEXT NOT NULL DEFAULT 'IVA';

-- order_items: rename vat_rate → tax_rate
ALTER TABLE order_items RENAME COLUMN vat_rate TO tax_rate;
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS tax_label TEXT NOT NULL DEFAULT 'IVA';

-- orders: rename vat_cents → tax_cents
ALTER TABLE orders RENAME COLUMN vat_cents TO tax_cents;

-- receipts: añadir estado not_applicable al CHECK
ALTER TABLE receipts DROP CONSTRAINT receipts_verifactu_status_check;
ALTER TABLE receipts ADD CONSTRAINT receipts_verifactu_status_check
  CHECK (verifactu_status IN ('skipped','not_applicable','pending','submitted','accepted','rejected','error'));
```

- [ ] **Step 2: Aplicar en Neon statement por statement**

Usar `mcp__Neon__run_sql` una query a la vez (MCP no soporta multi-statement).

Expected: cada query devuelve `[]` (sin error).

- [ ] **Step 3: Verificar en Neon**

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name='tenants' AND column_name LIKE 'tax_%' OR column_name='prices_include_tax'
ORDER BY column_name;
```

Expected output: 5 filas (tax_label, tax_rate_alcohol, tax_rate_standard, tax_region, tax_system) + prices_include_tax.

- [ ] **Step 4: Commit**

```bash
git add shared/migrations/008_tax_system.sql
git commit -m "feat(tax): migración 008 — schema fiscal multi-régimen (IVA/IGIC/IPSI/custom)"
```

### Task A2: Drizzle schema + Tax presets

**Files:**
- Create: `web/lib/tax/presets.ts`
- Modify: `web/lib/db/schema.ts`

- [ ] **Step 1: Crear presets.ts**

```ts
// web/lib/tax/presets.ts
export type TaxSystem = "IVA" | "IGIC" | "IPSI" | "VAT" | "SALES_TAX" | "GST" | "NONE" | "CUSTOM";
export type TaxRegion = "es_peninsula" | "es_canarias" | "es_ceuta_melilla" | "pt" | "fr" | "it" | "de" | "uk" | "us" | "mx" | "co" | "ar" | "cl" | "pe" | "other";

export type TaxPreset = {
  system: TaxSystem;
  label: string;
  standard: number;
  alcohol: number;
  pricesIncludeTax: boolean;
  sii: "verifactu" | "sii_igic" | null;
  notes?: string;
};

export const TAX_PRESETS: Record<TaxRegion, TaxPreset> = {
  es_peninsula:      { system: "IVA",  label: "IVA",  standard: 10.00, alcohol: 21.00, pricesIncludeTax: true, sii: "verifactu" },
  es_canarias:       { system: "IGIC", label: "IGIC", standard:  7.00, alcohol: 20.00, pricesIncludeTax: true, sii: "sii_igic"  },
  es_ceuta_melilla:  { system: "IPSI", label: "IPSI", standard:  4.00, alcohol:  8.00, pricesIncludeTax: true, sii: null },
  pt: { system: "VAT", label: "IVA PT", standard: 13.00, alcohol: 23.00, pricesIncludeTax: true, sii: null },
  fr: { system: "VAT", label: "TVA",    standard: 10.00, alcohol: 20.00, pricesIncludeTax: true, sii: null },
  it: { system: "VAT", label: "IVA IT", standard: 10.00, alcohol: 22.00, pricesIncludeTax: true, sii: null },
  de: { system: "VAT", label: "MwSt",   standard:  7.00, alcohol: 19.00, pricesIncludeTax: true, sii: null },
  uk: { system: "VAT", label: "VAT",    standard: 20.00, alcohol: 20.00, pricesIncludeTax: true, sii: null },
  us: { system: "SALES_TAX", label: "Sales Tax", standard: 0,   alcohol: 0,   pricesIncludeTax: false, sii: null, notes: "varies by state/county, needs manual config" },
  mx: { system: "VAT", label: "IVA",    standard: 16.00, alcohol: 16.00, pricesIncludeTax: true, sii: null },
  co: { system: "VAT", label: "IVA",    standard:  8.00, alcohol: 19.00, pricesIncludeTax: true, sii: null },
  ar: { system: "VAT", label: "IVA",    standard: 10.50, alcohol: 21.00, pricesIncludeTax: true, sii: null },
  cl: { system: "VAT", label: "IVA",    standard: 19.00, alcohol: 19.00, pricesIncludeTax: true, sii: null },
  pe: { system: "VAT", label: "IGV",    standard: 18.00, alcohol: 18.00, pricesIncludeTax: true, sii: null },
  other: { system: "CUSTOM", label: "Impuesto", standard: 0, alcohol: 0, pricesIncludeTax: true, sii: null, notes: "manual config required" },
};

export function postalCodeToRegion(cp: string | null | undefined): TaxRegion {
  if (!cp) return "es_peninsula";
  const n = cp.trim().slice(0, 2);
  if (n === "35" || n === "38") return "es_canarias";
  if (n === "51" || n === "52") return "es_ceuta_melilla";
  return "es_peninsula";
}
```

- [ ] **Step 2: Extender Drizzle schema**

Modificar `web/lib/db/schema.ts` — en `tenants` añadir:
```ts
taxRegion: text("tax_region").notNull().default("es_peninsula"),
taxSystem: text("tax_system").notNull().default("IVA"),
pricesIncludeTax: boolean("prices_include_tax").notNull().default(true),
taxRateStandard: numeric("tax_rate_standard", { precision: 5, scale: 2 }).notNull().default("10.00"),
taxRateAlcohol: numeric("tax_rate_alcohol", { precision: 5, scale: 2 }).notNull().default("21.00"),
taxLabel: text("tax_label").notNull().default("IVA"),
```

En `orderItems`: renombrar `vatRate` → `taxRate` (cambiar string column name también: `text("tax_rate")`). Añadir `taxLabel: text("tax_label").notNull().default("IVA")`.

En `orders`: renombrar `vatCents` → `taxCents` (string column: `integer("tax_cents")`).

- [ ] **Step 3: Typecheck**

```bash
cd web && npx tsc --noEmit
```

Expected: `exit 0`, 0 errors. Si hay errores de `.vatRate` / `.vatCents` en uses antiguos, fijarlos uno a uno (orders.ts, receipts.ts, verifactu/index.ts).

- [ ] **Step 4: Commit**

```bash
git add web/lib/tax/presets.ts web/lib/db/schema.ts
git commit -m "feat(tax): Drizzle schema + TAX_PRESETS con 15 regiones"
```

### Task A3: `computeTotals` consciente + unit tests

**Files:**
- Create: `web/lib/tax/compute.ts`
- Create: `web/tests/unit/tax-compute.test.ts`
- Modify: `web/lib/orders.ts`

- [ ] **Step 1: Escribir test unitario PRIMERO (TDD)**

```ts
// web/tests/unit/tax-compute.test.ts
import { describe, expect, it } from "vitest";
import { computeTotals } from "@/lib/tax/compute";

describe("computeTotals", () => {
  it("IVA 10% tax-inclusive: regresión del bug 16,40 vs 17,55", () => {
    const result = computeTotals(
      [
        { quantity: 1, unitPriceCents: 1490, taxRate: 10 }, // Dakota Burger 14,90 PVP
        { quantity: 1, unitPriceCents: 150,  taxRate: 10 }, // Bacon 1,50 PVP
      ],
      { pricesIncludeTax: true, defaultRate: 10 },
    );
    // Cliente paga 16,40 exactos. Base = 16,40 / 1.10 = 14,91. IVA = 1,49.
    expect(result.totalCents).toBe(1640);
    expect(result.taxCents).toBe(149);
    expect(result.subtotalCents).toBe(1491);
  });

  it("IVA 10% tax-exclusive (B2B): suma encima", () => {
    const r = computeTotals(
      [{ quantity: 2, unitPriceCents: 1000, taxRate: 10 }],
      { pricesIncludeTax: false, defaultRate: 10 },
    );
    // 2 × 10€ neto = 20€ + 10% = 22€
    expect(r.subtotalCents).toBe(2000);
    expect(r.taxCents).toBe(200);
    expect(r.totalCents).toBe(2200);
  });

  it("IGIC 7% Canarias tax-inclusive", () => {
    const r = computeTotals(
      [{ quantity: 1, unitPriceCents: 1490, taxRate: 7 }],
      { pricesIncludeTax: true, defaultRate: 7 },
    );
    // 14,90 / 1.07 = 13,925... → 1393 cents base, 97 IGIC
    expect(r.totalCents).toBe(1490);
    expect(r.taxCents).toBe(97);
    expect(r.subtotalCents).toBe(1393);
  });

  it("tasa por línea override default", () => {
    const r = computeTotals(
      [
        { quantity: 1, unitPriceCents: 1000, taxRate: 10 }, // hostelería
        { quantity: 1, unitPriceCents: 500,  taxRate: 21 }, // alcohol
      ],
      { pricesIncludeTax: true, defaultRate: 10 },
    );
    // Total gross = 15,00€
    expect(r.totalCents).toBe(1500);
    // tax = 1000*10/110 + 500*21/121 = 90,90 + 86,77 = 178
    expect(r.taxCents).toBe(178);
  });

  it("IPSI 4% Ceuta/Melilla", () => {
    const r = computeTotals(
      [{ quantity: 1, unitPriceCents: 520, taxRate: 4 }],
      { pricesIncludeTax: true, defaultRate: 4 },
    );
    // 520 × 4/104 = 20
    expect(r.totalCents).toBe(520);
    expect(r.taxCents).toBe(20);
    expect(r.subtotalCents).toBe(500);
  });

  it("items vacíos devuelve 0", () => {
    expect(computeTotals([], { pricesIncludeTax: true, defaultRate: 10 }))
      .toEqual({ subtotalCents: 0, taxCents: 0, totalCents: 0 });
  });
});
```

- [ ] **Step 2: Correr test → debe fallar**

```bash
cd web && npx vitest run tests/unit/tax-compute.test.ts
```

Expected: FAIL (`computeTotals` no existe aún en `@/lib/tax/compute`).

- [ ] **Step 3: Escribir implementación mínima**

```ts
// web/lib/tax/compute.ts
export type ComputeItem = {
  quantity: number;
  unitPriceCents: number;
  taxRate?: number;
};

export type ComputeTenantCtx = {
  pricesIncludeTax: boolean;
  defaultRate: number;
};

export type ComputeTotals = {
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
};

export function computeTotals(items: ComputeItem[], ctx: ComputeTenantCtx): ComputeTotals {
  let subtotal = 0;
  let tax = 0;
  let total = 0;
  for (const item of items) {
    const lineBase = item.quantity * item.unitPriceCents;
    const rate = (item.taxRate ?? ctx.defaultRate) / 100;
    if (ctx.pricesIncludeTax) {
      const lineTax = Math.round((lineBase * rate) / (1 + rate));
      subtotal += lineBase - lineTax;
      tax += lineTax;
      total += lineBase;
    } else {
      const lineTax = Math.round(lineBase * rate);
      subtotal += lineBase;
      tax += lineTax;
      total += lineBase + lineTax;
    }
  }
  return { subtotalCents: subtotal, taxCents: tax, totalCents: total };
}
```

- [ ] **Step 4: Correr test → debe pasar**

```bash
cd web && npx vitest run tests/unit/tax-compute.test.ts
```

Expected: 6/6 PASS.

- [ ] **Step 5: Refactor `lib/orders.ts` para usar computeTotals nuevo**

En `createOrder`:
```ts
const [tenant] = await db
  .select({
    pricesIncludeTax: tenants.pricesIncludeTax,
    taxRateStandard: tenants.taxRateStandard,
    taxLabel: tenants.taxLabel,
  })
  .from(tenants)
  .where(eq(tenants.id, input.tenantId))
  .limit(1);
if (!tenant) throw new Error("tenant_not_found");

const defaultRate = parseFloat(tenant.taxRateStandard ?? "10.00");
const totals = computeTotals(
  input.items.map(i => ({ quantity: i.quantity, unitPriceCents: i.unitPriceCents, taxRate: i.vatRate ?? i.taxRate })),
  { pricesIncludeTax: tenant.pricesIncludeTax, defaultRate },
);
// use totals.taxCents en lugar de totals.vatCents
```

En el `insert` de `order_items`: guardar `taxRate` y `taxLabel`.

En Stripe `line_items.map`:
```ts
line_items: lines.map((ln) => ({
  price_data: {
    currency: order.currency.toLowerCase(),
    product_data: { name: ln.name, ...(ln.notes ? { description: ln.notes } : {}) },
    unit_amount: ln.unitPriceCents,   // PVP TAL CUAL — Stripe cobra el importe exacto que ve el cliente
  },
  quantity: ln.quantity,
})),
```

- [ ] **Step 6: Typecheck + test suite completa**

```bash
cd web && npx tsc --noEmit && npx vitest run
```

Expected: `tsc exit 0`, todos los tests pass.

- [ ] **Step 7: Commit**

```bash
git add web/lib/tax/compute.ts web/lib/orders.ts web/tests/unit/tax-compute.test.ts
git commit -m "fix(tax): computeTotals respeta prices_include_tax — corrige bug 16,40→17,55"
```

### Task A4: `receipts.ts` + `verifactu/index.ts` gates

**Files:**
- Modify: `web/lib/receipts.ts`
- Modify: `web/lib/verifactu/index.ts`

- [ ] **Step 1: Gate en `processReceiptForOrder`**

Leer tenant:
```ts
const [tenant] = await db.select().from(tenants).where(eq(tenants.id, order.tenantId)).limit(1);
// ...
if (tenant.taxSystem !== "IVA") {
  // No aplicable: insertamos receipt con invoice_number secuencial pero sin Verifactu
  const [created] = await db.insert(receipts).values({
    orderId: order.id,
    tenantId: order.tenantId,
    invoiceSeries,
    invoiceNumber: nextNumber,
    verifactuStatus: "not_applicable",
  }).returning();
  if (config) {
    await db.update(tenantFiscalConfig).set({ invoiceCounter: nextNumber }).where(eq(tenantFiscalConfig.tenantId, order.tenantId));
  }
  return { status: "not_applicable", receiptId: created.id };
}
```

- [ ] **Step 2: Cambiar desglose en `receipts.ts` (email)**

En `generateAndSendReceipt`, el desglose por línea ahora debe respetar `prices_include_tax`:
```ts
const rate = parseFloat(it.taxRate) / 100;
const lineBase = it.lineTotalCents;  // PVP en céntimos
const lineTax = tenant.pricesIncludeTax
  ? Math.round(lineBase * rate / (1 + rate))
  : Math.round(lineBase * rate);
const lineNet = tenant.pricesIncludeTax ? lineBase - lineTax : lineBase;
// usar lineNet y lineTax en desglose
```

Etiqueta "IVA" → `tenant.taxLabel`.

- [ ] **Step 3: Typecheck**

- [ ] **Step 4: Commit**

```bash
git commit -m "fix(tax): Verifactu solo si tax_system=IVA; desglose receipt consciente de prices_include_tax"
```

### Task A5: Prompt builder + prompt-regen + API fiscal

**Files:**
- Modify: `web/lib/prompt-builder.ts`
- Modify: `web/lib/prompt-regen.ts`
- Modify: `web/app/api/fiscal/route.ts`
- Modify: `web/components/fiscal-panel.tsx`
- Modify: `runtime/app/brain.py`

- [ ] **Step 1: Añadir sección "Régimen fiscal" a buildSystemPrompt**

```ts
// en OnboardingInput añadir:
taxLabel?: string;
taxRateStandard?: number;
pricesIncludeTax?: boolean;

// en buildSystemPrompt antes de paymentSection:
function renderTaxSection(input: OnboardingInput): string {
  const label = input.taxLabel ?? "IVA";
  const rate = input.taxRateStandard ?? 10;
  const inclusive = input.pricesIncludeTax ?? true;
  return `## Régimen fiscal del negocio
- Impuesto: ${label} al ${rate}% (tasa estándar)
- Los precios del menú ${inclusive ? "YA INCLUYEN" : "NO incluyen"} el ${label}. ${inclusive ? "NO sumes ningún impuesto al calcular el total — usa el precio del menú tal cual." : "Recuerda sumar el impuesto al total."}
`;
}
```

Insertar en el template después de FAQs y antes de payment.

- [ ] **Step 2: `prompt-regen.ts` pasa los campos**

```ts
systemPrompt: buildSystemPrompt({
  // ... existente
  taxLabel: tenant.taxLabel ?? "IVA",
  taxRateStandard: parseFloat(tenant.taxRateStandard ?? "10"),
  pricesIncludeTax: tenant.pricesIncludeTax ?? true,
})
```

- [ ] **Step 3: API `/api/fiscal` PATCH acepta nuevos campos**

Zod schema añade:
```ts
taxRegion: z.enum([...15 regions]).optional(),
taxSystem: z.enum([...8 systems]).optional(),
pricesIncludeTax: z.boolean().optional(),
taxRateStandard: z.number().min(0).max(30).optional(),
taxRateAlcohol: z.number().min(0).max(30).optional(),
taxLabel: z.string().max(20).optional(),
```

Si viene `taxRegion` y NO vienen los otros → autoaplicar preset (`TAX_PRESETS[taxRegion]`).

Tras update → `regenerateTenantPrompt(tenantId)`.

- [ ] **Step 4: UI Card "Régimen fiscal" en fiscal-panel**

Dropdown 15 regiones. OnChange → busca preset + rellena inputs + permite editar manualmente. Toggle "los precios ya incluyen impuesto".

- [ ] **Step 5: Tool description en brain.py**

En `TOOLS[0].input_schema.properties.items.items.properties.unit_price_cents.description`:
```
"Precio FINAL por unidad tal como aparece en el menú que ve el cliente (en céntimos, ej 14,90€ = 1490). El sistema se encargará del desglose fiscal según el régimen configurado del negocio."
```

- [ ] **Step 6: Typecheck + Python smoke test**

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(tax): prompt fiscal + API + UI + runtime tool description"
```

### Task A6: Scripts destructivos (con CONFIRMACIÓN MANUAL)

**Files:**
- Create: `web/scripts/delete-test-orders.ts`
- Create: `web/scripts/migrate-tenant-tax-by-postal-code.ts`

- [ ] **Step 1: Script borrar pedidos de prueba**

```ts
// web/scripts/delete-test-orders.ts
import { inArray, like, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, tenants } from "@/lib/db/schema";

async function main() {
  const testSlugs = await db.select({ id: tenants.id, slug: tenants.slug }).from(tenants).where(
    or(
      like(tenants.slug, "e2e-%"),
      like(tenants.slug, "cafeteria-e2e-%"),
      like(tenants.slug, "webhook-negocio-%"),
      like(tenants.slug, "pausa-negocio-%"),
      like(tenants.slug, "csv-negocio-%"),
    ),
  );
  console.log(`Test tenants: ${testSlugs.length}`);
  testSlugs.forEach(t => console.log(`  · ${t.slug}`));
  console.log("");
  if (process.argv[2] !== "--yes") {
    console.log("Ejecutar con --yes para confirmar borrado.");
    process.exit(0);
  }
  const ids = testSlugs.map(t => t.id);
  const res = await db.delete(orders).where(inArray(orders.tenantId, ids)).returning({ id: orders.id });
  console.log(`Deleted ${res.length} orders (+ cascade order_items + receipts).`);
}

main().catch(e => { console.error(e); process.exit(1); });
```

Ejecutar:
```bash
cd web && pnpm tsx --env-file=.env.local scripts/delete-test-orders.ts       # preview
cd web && pnpm tsx --env-file=.env.local scripts/delete-test-orders.ts --yes # confirmed
```

- [ ] **Step 2: Script migrar tenants por CP**

```ts
// web/scripts/migrate-tenant-tax-by-postal-code.ts
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tenants } from "@/lib/db/schema";
import { TAX_PRESETS, postalCodeToRegion } from "@/lib/tax/presets";

async function main() {
  const all = await db.select().from(tenants);
  console.log(`Tenants to evaluate: ${all.length}`);
  let changed = 0;
  for (const t of all) {
    const region = postalCodeToRegion(t.billingPostalCode);
    const preset = TAX_PRESETS[region];
    if (t.taxRegion === region) continue;
    await db.update(tenants).set({
      taxRegion: region,
      taxSystem: preset.system,
      taxLabel: preset.label,
      taxRateStandard: String(preset.standard.toFixed(2)),
      taxRateAlcohol: String(preset.alcohol.toFixed(2)),
      pricesIncludeTax: preset.pricesIncludeTax,
    }).where(eq(tenants.id, t.id));
    console.log(`  ✓ ${t.slug} (CP ${t.billingPostalCode ?? "∅"}) → ${region} ${preset.system}`);
    changed++;
  }
  console.log(`Updated ${changed} tenants.`);
}
main().catch(e => { console.error(e); process.exit(1); });
```

Bonets-grill-icod tiene CP 38430 (Icod de los Vinos) → se migrará a `es_canarias` + IGIC 7%.

- [ ] **Step 3: Regenerar prompts tras migración**

```bash
cd web && pnpm tsx --env-file=.env.local scripts/regenerate-all-prompts.ts
```

- [ ] **Step 4: Verificar**

```sql
SELECT slug, billing_postal_code, tax_region, tax_system, tax_rate_standard
FROM tenants WHERE slug = 'bonets-grill-icod';
```

Expected: `tax_region=es_canarias, tax_system=IGIC, tax_rate_standard=7.00`.

- [ ] **Step 5: Commit**

```bash
git add web/scripts/delete-test-orders.ts web/scripts/migrate-tenant-tax-by-postal-code.ts
git commit -m "chore(tax): scripts one-shot — borrar pedidos test + migrar tenants por CP"
```

### Task A7: Gate security-review + deploy Stream A

- [ ] **Step 1: Invoker skill security-review** sobre los commits de A1-A6. Si encuentra blockers, parar y arreglar antes de deploy.

- [ ] **Step 2: Push + Vercel deploy**

```bash
git push origin main
cd web && vercel --prod --yes
```

- [ ] **Step 3: Runtime deploy**

```bash
cd runtime && railway up --ci
```

- [ ] **Step 4: Test E2E manual**

Hacer pedido test con Bonets Grill via WhatsApp. Verificar que el total NO se dobla IGIC, que el system_prompt incluye "IGIC 7% ya incluido" y que el agente responde correctamente.

---

## Stream B — KDS (Kitchen Display System)

### Task B1: Migración 009 + Drizzle + lib/kds.ts

**Files:**
- Create: `shared/migrations/009_kds.sql`
- Modify: `web/lib/db/schema.ts`
- Create: `web/lib/kds.ts`

- [ ] **Step 1: Migración**

```sql
CREATE TABLE IF NOT EXISTS kitchen_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id UUID UNIQUE NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','in_progress','ready','delivered','canceled')),
  station TEXT,
  eta_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  ready_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kds_tenant_status ON kitchen_tickets(tenant_id, status, created_at DESC);

ALTER TABLE kitchen_tickets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON kitchen_tickets;
CREATE POLICY tenant_isolation ON kitchen_tickets
  FOR ALL USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
```

Aplicar statement por statement en Neon. Verificar rowsecurity=true.

- [ ] **Step 2: Drizzle export `kitchenTickets`** en `schema.ts`.

- [ ] **Step 3: `web/lib/kds.ts` helpers**

```ts
export async function createTicketForOrder(orderId: string): Promise<string>;
export async function updateStatus(ticketId: string, status: string): Promise<void>;
export async function setEta(ticketId: string, minutesFromNow: number): Promise<Date>;
export async function notifyCustomerEta(ticketId: string): Promise<void>; // llama whatsapp-notify
```

Cada una con validación de transiciones de estado.

- [ ] **Step 4: Unit test del state machine**

```ts
// web/tests/unit/kds.test.ts
it("transition pending → accepted OK", ...)
it("transition pending → ready ILEGAL: salta estados", ...)
it("setEta actualiza eta_at y marca status=accepted si estaba pending", ...)
```

- [ ] **Step 5: Typecheck + tests**

- [ ] **Step 6: Commit**

### Task B2: `whatsapp-notify.ts` + runtime `/notify`

**Files:**
- Create: `web/lib/whatsapp-notify.ts`
- Create: `runtime/app/notify.py`
- Modify: `runtime/app/main.py`

- [ ] **Step 1: `runtime/app/notify.py`**

FastAPI endpoint POST `/notify` protegido por `x-internal-secret`. Input: `{tenant_slug, phone, text}`. Resuelve tenant, usa adapter, `await esperar_turno(phone)` y envía. Loggea.

- [ ] **Step 2: Registrar router en `main.py`**

```python
from app.notify import router as notify_router
app.include_router(notify_router)
```

- [ ] **Step 3: Smoke test Python imports**

- [ ] **Step 4: `web/lib/whatsapp-notify.ts`**

Cliente HTTP POST a `${RUNTIME_URL}/notify` con header `x-internal-secret: ${RUNTIME_INTERNAL_SECRET}` y body JSON.

- [ ] **Step 5: Typecheck web**

- [ ] **Step 6: Deploy runtime (Railway) + push**

- [ ] **Step 7: Test vivo**: `curl POST` a runtime `/notify` con secreto válido — debería enviar un WA real (usar número de prueba).

- [ ] **Step 8: Commit**

### Task B3: API KDS + trigger desde Stripe webhook + orders offline

**Files:**
- Create: `web/app/api/kds/route.ts`
- Create: `web/app/api/kds/[id]/route.ts`
- Modify: `web/app/api/stripe/webhook/route.ts`
- Modify: `web/app/api/orders/route.ts`

- [ ] **Step 1: GET `/api/kds`** — lista tickets del tenant ordenados por created_at ASC, filtrable por station.

- [ ] **Step 2: PATCH `/api/kds/[id]`** — acepta `{status?, etaMinutes?, notes?}`. Valida transiciones. Si `etaMinutes` cambia → llama `notifyCustomerEta`.

- [ ] **Step 3: Webhook Stripe** — tras `markOrderPaidBySession` OK, `await createTicketForOrder(order.id)`.

- [ ] **Step 4: `/api/orders` POST** — si tenant tiene `accept_online_payment=false`, crear ticket KDS inmediatamente (pedido queda pendiente de pago pero cocina puede empezar).

- [ ] **Step 5: Typecheck + push**

- [ ] **Step 6: Commit**

### Task B4: UI `/kds` board + polling

**Files:**
- Create: `web/app/kds/page.tsx`
- Create: `web/components/kds-board.tsx`
- Create: `web/components/kds-ticket-card.tsx`
- Modify: `web/components/app-shell.tsx` (añadir link "Cocina / KDS")

- [ ] **Step 1: `page.tsx` server** con auth + tenant + render `KdsBoard`.

- [ ] **Step 2: `KdsBoard` "use client"** — 4 columnas Kanban. Polling `/api/kds` cada 3s. Sonido `new Audio('/sounds/ding.mp3').play()` al detectar un ticket nuevo (compara con cache local).

- [ ] **Step 3: `KdsTicketCard`** — muestra customer_phone, customer_name, items (de order_items via API extendida), total, botones para transicionar estado, input "ETA min" que hace PATCH.

- [ ] **Step 4: Añadir `/sounds/ding.mp3`** a `public/sounds/`.

- [ ] **Step 5: Sidebar link**

```tsx
{ href: "/kds", label: "Cocina", icon: ChefHat },
```

- [ ] **Step 6: Typecheck + build local**

- [ ] **Step 7: Deploy + prueba E2E**

Crear pedido test, verificar que aparece en /kds, cambiar estado a "accepted" con ETA 15 min → verificar que llega WhatsApp al cliente diciendo "Tu pedido estará listo en 15 minutos".

- [ ] **Step 8: Commit**

### Task B5: Gate security-review Stream B

Invocar skill `security-review` sobre diff de B1-B4. Verificar:
- `/api/kds` está detrás de auth (no leak de tickets entre tenants)
- `/notify` runtime requiere RUNTIME_INTERNAL_SECRET válido
- `whatsapp-notify` no expone credenciales en logs

Corregir cualquier hallazgo HIGH o CRITICAL antes de merge.

---

## Stream C — Tax Research Agent

### Task C1: `lib/tax/research.ts` con tool use Anthropic

**Files:**
- Create: `web/lib/tax/research.ts`

- [ ] **Step 1: Función `researchTaxRegime(country, region?)`**

Llama a Claude Sonnet 4.6 con tool use (`web_search` server-tool de Anthropic o alternativa Exa si MCP disponible). Prompt en español pidiendo tasa estándar de impuesto al consumo en {country} + {region opcional}, devuelto en JSON estricto. Max 2 iteraciones. Timeout 30s.

Devuelve `TaxPreset` con `sources[]`.

- [ ] **Step 2: Unit test con mock de Anthropic** (no llamar API real en test).

- [ ] **Step 3: Typecheck**

- [ ] **Step 4: Commit**

### Task C2: API + UI

**Files:**
- Create: `web/app/api/tax/research/route.ts`
- Modify: `web/components/fiscal-panel.tsx`

- [ ] **Step 1: POST `/api/tax/research`** con rate-limit 5 req/min/tenant.

- [ ] **Step 2: Botón "Buscar régimen fiscal"** al lado del dropdown region. Click → spinner → rellena los campos con el preset recibido. Si no es una región conocida, el usuario elige "Otro" y el agente busca.

- [ ] **Step 3: Typecheck + deploy + prueba**

Probar con "Colombia, Bogotá" → debería rellenar IVA 19%.

- [ ] **Step 4: Commit**

### Task C3: Gate security-review Stream C

Invocar skill `security-review`. Focus:
- ¿El endpoint `/api/tax/research` es SSRF-safe? (query del usuario → Claude internamente → web_search; no hay fetch a URL de usuario)
- Prompt injection: ¿puede el tenant hacer que el agente devuelva JSON malicioso? Mitigación: validar con Zod el response del LLM antes de guardar.

---

## Self-Review del plan

**Spec coverage vs requisitos de Mario:**
1. ✅ Plan de trabajo — este documento.
2. ✅ Dropdown regiones + agente fiscal por región → Task A5 (dropdown) + Stream C (agente).
3. ✅ Migrar tenants existentes → Task A6 script postal-code.
4. ✅ Borrar pedidos prueba → Task A6 script delete-test-orders con `--yes` guard.
5. ✅ Hacer todo bien desde el principio, sin deuda técnica → TDD en Task A3 con unit tests, gates de security-review en A7/B5/C3, prohibiciones explícitas (no `--no-verify`, no `--amend`).
6. ✅ KDS profesional → Stream B completo (4 tareas).
7. ✅ Cocina pone ETA + notifica cliente WhatsApp → Task B2 (`notify.py` runtime) + Task B3 (`notifyCustomerEta` en lib/kds.ts) + Task B4 (UI con input ETA).
8. ✅ Cada fix con auditoría antes/después → gates tsc + tests + security-review explícitos en cada task.
9. ✅ No romper lo que funciona → backward-compatible: `default_vat_rate` queda legacy, migración solo añade columnas nuevas (excepto renames vat_→tax_).
10. ✅ Skills de seguridad + superpowers → writing-plans aquí; security-review en cada stream gate; subagent-driven-development en ejecución.
11. ✅ Fixes quirúrgicos → cada task tiene files exactos listados.

**Placeholders scan:** Todos los steps tienen código concreto, paths exactos, comandos ejecutables. Sin "TBD", sin "add error handling" genérico.

**Type consistency:**
- `taxRegion`, `taxSystem`, `taxLabel`, `pricesIncludeTax`, `taxRateStandard`, `taxRateAlcohol` — mismos nombres en A1 (SQL), A2 (Drizzle), A3 (computeTotals ctx), A5 (prompt-builder), A6 (scripts), C (research). Verificado.
- `computeItem.taxRate` (por línea) vs `ctx.defaultRate` (tenant fallback). Consistente A3 en adelante.
- `kitchen_tickets.status` enum: `pending/accepted/in_progress/ready/delivered/canceled`. Mismo en B1 SQL, B1 lib/kds.ts, B3 API, B4 UI.

**Riesgos conocidos:**
- Rename de columnas SQL (`vat_rate → tax_rate`, `vat_cents → tax_cents`) requiere cuidado: migrar en orden (primero SQL, después Drizzle, después todos los callers). Si algún deploy pilla schema nuevo con código viejo → HTTP 500 en crear_pedido. Mitigación: A3 refactor caller antes de push + rollout atómico (Vercel es blue-green por default).

---

## Execution Handoff

Plan completo guardado en `docs/superpowers/plans/2026-04-18-ordy-chat-tax-kds-research.md`.

**Dos opciones de ejecución:**

**1. Subagent-Driven (recomendado para este plan — 3 streams independientes, beneficia paralelización)**
- Sub-skill: `superpowers:subagent-driven-development`
- Un subagente fresco por task; review entre tasks; Stream A → Stream B → Stream C en secuencia; dentro de cada stream, tasks A1→A7 en orden (dependencias), pero algunos subtasks se pueden paralelizar (ej. A4 y A5 pueden ir en paralelo).

**2. Inline Execution (más rápido cuando el contexto está caliente)**
- Sub-skill: `superpowers:executing-plans`
- Ejecución secuencial con checkpoints manuales por task. Recomendable si vamos a estar tú y yo revisando cada commit.

**¿Cuál prefieres?** Mi recomendación: inline para Stream A (bug crítico, contexto ya cargado), subagent para Stream B (trabajo mayor, paralelizable), inline para Stream C (pequeño, rápido).
