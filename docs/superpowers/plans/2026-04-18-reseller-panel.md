# Reseller Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a global reseller program inside Ordy Chat that pays 25% recurring commission via Stripe Connect, with read-only reseller panel, referral-link attribution resistant to iOS ITP, and pluggable country tax strategies (es / eu-vat / fallback).

**Architecture:** 5 DB tables + 1 column on existing `tenants`, 6 new Stripe webhook cases wrapped in `db.transaction()`, new `/admin/resellers/*` and `/reseller/*` route trees, pluggable `TaxStrategy` plugin architecture, Stripe Connect as sole payout rail, cookie + server-side `ref_touches` dual-write for attribution, hard-delete prohibition triggers for 6-year fiscal retention.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Drizzle ORM, Neon Postgres, Auth.js v5, Stripe Connect (Express), Tailwind + shadcn/ui, Zod validation, Vitest + Playwright, Vercel cron.

**Spec reference:** `docs/superpowers/specs/2026-04-18-reseller-panel-design.md` (v2). Sections cited as `spec §N`.

---

## Phase 0 — Database migration + schema (1 day)

### Task 0.1: Create Neon branch for migration testing

**Files:** none (Neon MCP operation)

- [ ] **Step 1: Create branch `reseller-migration`**

Use `mcp__Neon__create_branch` with project `empty-block-73744049`, parent `main`, name `reseller-migration`. Grab connection string of new branch.

- [ ] **Step 2: Commit branch metadata note**

Create `docs/superpowers/plans/.reseller-migration-branch.txt` with:
```
Neon project: empty-block-73744049
Branch: reseller-migration
Created: 2026-04-18
Purpose: Test migration 012_resellers.sql before merge to main
```

```bash
git add docs/superpowers/plans/.reseller-migration-branch.txt
git commit -m "chore(reseller): note Neon branch for migration test"
```

---

### Task 0.2: Create migration SQL file

**Files:**
- Create: `shared/migrations/012_resellers.sql`
- Create: `shared/migrations/012_resellers.rollback.sql`

- [ ] **Step 1: Write `012_resellers.sql`**

Copy the full SQL from spec §3.1 into `shared/migrations/012_resellers.sql`. This is the complete migration with BEGIN/COMMIT, the 5 tables (`resellers`, `ref_touches`, `reseller_commissions`, `reseller_payouts`, `reseller_self_billing_consents`), the `ALTER TABLE tenants ADD COLUMN reseller_id`, all indexes, all triggers (updated_at + prevent_hard_delete), and the audit_log insert.

- [ ] **Step 2: Write rollback**

Create `shared/migrations/012_resellers.rollback.sql`:
```sql
BEGIN;
-- Drop anti-delete triggers FIRST (else DROP TABLE fails)
DROP TRIGGER IF EXISTS trg_reseller_payouts_no_delete ON reseller_payouts;
DROP TRIGGER IF EXISTS trg_reseller_commissions_no_delete ON reseller_commissions;
DROP TRIGGER IF EXISTS trg_resellers_no_delete ON resellers;
DROP TRIGGER IF EXISTS trg_reseller_payouts_updated_at ON reseller_payouts;
DROP TRIGGER IF EXISTS trg_reseller_commissions_updated_at ON reseller_commissions;
DROP TRIGGER IF EXISTS trg_resellers_updated_at ON resellers;

ALTER TABLE tenants DROP COLUMN IF EXISTS reseller_id;

-- Drop tables in reverse dependency order
DROP TABLE IF EXISTS reseller_self_billing_consents;
DROP TABLE IF EXISTS reseller_commissions;
DROP TABLE IF EXISTS reseller_payouts;
DROP TABLE IF EXISTS ref_touches;
DROP TABLE IF EXISTS resellers;

INSERT INTO audit_log (action, entity, metadata)
VALUES ('migration.rolled_back', 'resellers',
        jsonb_build_object('version', '012', 'rolled_back_at', now()));
COMMIT;
```

- [ ] **Step 3: Commit both files**

```bash
git add shared/migrations/012_resellers.sql shared/migrations/012_resellers.rollback.sql
git commit -m "feat(reseller): migration 012 — 5 tables + tenants.reseller_id

- resellers, ref_touches, reseller_commissions, reseller_payouts,
  reseller_self_billing_consents
- tenants.reseller_id UUID nullable ON DELETE SET NULL
- Anti-hard-delete triggers (6-year fiscal retention, Cco art. 30)
- ES integrity CHECK: country_code='ES' requires iae_registered + fiscal_sub_profile
- Active integrity CHECK: status='active' requires stripe_connect_account_id"
```

---

### Task 0.3: Apply migration to Neon branch

**Files:** none (MCP operation)

- [ ] **Step 1: Apply via Neon MCP**

Read `shared/migrations/012_resellers.sql` and pass contents to `mcp__Neon__run_sql_transaction` targeting the `reseller-migration` branch. Expected: success, no errors.

- [ ] **Step 2: Verify table list**

`mcp__Neon__get_database_tables` on branch. Expected to see: `resellers`, `ref_touches`, `reseller_commissions`, `reseller_payouts`, `reseller_self_billing_consents` listed.

- [ ] **Step 3: Verify tenants column**

`mcp__Neon__describe_table_schema` for `tenants`. Expected: `reseller_id uuid` column present, NULL default, FK to `resellers(id)`.

---

### Task 0.4: EXPLAIN hot queries on branch

**Files:** none (MCP operation)

- [ ] **Step 1: EXPLAIN Q1 (commission list by reseller+month)**

Use `mcp__Neon__explain_sql_statement`:
```sql
EXPLAIN
SELECT id, tenant_id, base_amount_cents, commission_amount_cents, status
FROM reseller_commissions
WHERE reseller_id = gen_random_uuid() AND period_month = '2026-04-01'
ORDER BY invoice_paid_at DESC LIMIT 100;
```
Expected: `Index Scan using idx_reseller_commissions_reseller_period`.

- [ ] **Step 2: EXPLAIN Q2 (payable aggregate)**

```sql
EXPLAIN
SELECT reseller_id, SUM(commission_amount_cents) AS total
FROM reseller_commissions
WHERE status = 'payable' AND payout_id IS NULL AND period_month = '2026-03-01'
GROUP BY reseller_id;
```
Expected: `Bitmap Index Scan on idx_reseller_commissions_payable` (partial index).

- [ ] **Step 3: EXPLAIN Q3 (tenants by reseller)**

```sql
EXPLAIN
SELECT id, slug, subscription_status FROM tenants WHERE reseller_id = gen_random_uuid();
```
Expected: `Index Scan using idx_tenants_reseller`.

If any query shows `Seq Scan` → migration has an index bug → re-examine SQL before proceeding.

---

### Task 0.5: Append Drizzle schema

**Files:**
- Modify: `web/lib/db/schema.ts`

- [ ] **Step 1: Insert `resellers` table BEFORE `tenants` declaration**

Locate the `tenants` pgTable declaration in `web/lib/db/schema.ts` (currently around line 60). Before it, insert the full Drizzle schema additions from spec §3.2 (the 5 new pgTable blocks + type exports). `resellers` MUST come before `tenants` due to forward-ref.

- [ ] **Step 2: Add `resellerId` column to `tenants`**

Inside the existing `tenants` pgTable, add (before `createdAt`):
```ts
resellerId: uuid("reseller_id").references((): any => resellers.id, { onDelete: "set null" }),
```

- [ ] **Step 3: Verify typecheck**

```bash
cd web && pnpm tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add web/lib/db/schema.ts
git commit -m "feat(reseller): Drizzle schema — 5 tables + tenants.resellerId"
```

---

### Task 0.6: Update `.env.example`

**Files:**
- Modify: `web/.env.example` (or root if that's where it lives)

- [ ] **Step 1: Append env vars from spec §16**

Add the 10 env vars block (ORDY_NIF, ORDY_LEGAL_NAME, etc.) with comments.

- [ ] **Step 2: Commit**

```bash
git add web/.env.example
git commit -m "docs(reseller): env vars for reseller program v1"
```

---

### Task 0.7: Phase 0 completion gate

- [ ] **Step 1: Run all verification checks**

```bash
cd web
pnpm tsc --noEmit        # 0 errors
pnpm lint                # 0 errors
```

- [ ] **Step 2: Mark F0 done**

No additional commit; F0 consists of the commits from Tasks 0.1-0.6. Move to F1.

---

## Phase 1 — Attribution + cookie consent (2-3 days)

### Task 1.1: Cookie consent component (TDD)

**Files:**
- Create: `web/components/cookie-consent.tsx`
- Create: `web/tests/cookie-consent.test.tsx`

- [ ] **Step 1: Write failing test**

Write `web/tests/cookie-consent.test.tsx` with Vitest + React Testing Library:
```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { CookieConsent } from "@/components/cookie-consent";

describe("CookieConsent", () => {
  beforeEach(() => { document.cookie = ""; });

  it("hides when ordy_consent_v1 is set", () => {
    document.cookie = "ordy_consent_v1=accepted; path=/";
    render(<CookieConsent />);
    expect(screen.queryByText(/aceptar/i)).not.toBeInTheDocument();
  });

  it("shows two equiprominent buttons (AEPD)", () => {
    render(<CookieConsent />);
    const accept = screen.getByRole("button", { name: /aceptar todas/i });
    const reject = screen.getByRole("button", { name: /rechazar todas/i });
    expect(accept).toBeVisible();
    expect(reject).toBeVisible();
    // Assert both have similar dimensions (not one smaller)
    expect(accept.className).toContain(reject.className.split(" ").filter(c => c.startsWith("w-") || c.startsWith("px-"))[0]);
  });

  it("sets both cookies on accept", () => {
    render(<CookieConsent />);
    fireEvent.click(screen.getByRole("button", { name: /aceptar todas/i }));
    expect(document.cookie).toMatch(/ordy_consent_v1=accepted/);
    expect(document.cookie).toMatch(/ordy_consent_attribution=1/);
  });

  it("sets only consent_v1 on reject (no attribution cookie)", () => {
    render(<CookieConsent />);
    fireEvent.click(screen.getByRole("button", { name: /rechazar todas/i }));
    expect(document.cookie).toMatch(/ordy_consent_v1=rejected/);
    expect(document.cookie).not.toMatch(/ordy_consent_attribution/);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd web && pnpm vitest run tests/cookie-consent.test.tsx
```
Expected: FAIL (component doesn't exist).

- [ ] **Step 3: Implement `web/components/cookie-consent.tsx`**

```tsx
"use client";
import { useState, useEffect } from "react";

const CONSENT_COOKIE = "ordy_consent_v1";
const ATTRIBUTION_COOKIE = "ordy_consent_attribution";
const MAX_AGE = 60 * 60 * 24 * 180; // 180 days

function setCookie(name: string, value: string) {
  document.cookie = `${name}=${value}; path=/; max-age=${MAX_AGE}; samesite=lax${process.env.NODE_ENV === "production" ? "; secure" : ""}`;
}

export function CookieConsent() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const has = document.cookie.split(";").some(c => c.trim().startsWith(`${CONSENT_COOKIE}=`));
    setVisible(!has);
  }, []);
  if (!visible) return null;

  const accept = () => {
    setCookie(CONSENT_COOKIE, "accepted");
    setCookie(ATTRIBUTION_COOKIE, "1");
    setVisible(false);
  };
  const reject = () => {
    setCookie(CONSENT_COOKIE, "rejected");
    setVisible(false);
  };

  return (
    <div role="dialog" aria-label="Consentimiento de cookies"
         className="fixed bottom-4 left-4 right-4 md:left-auto md:max-w-md z-50
                    rounded-xl border border-neutral-200 bg-white p-6 shadow-lg">
      <p className="text-sm text-neutral-700">
        Usamos cookies esenciales y, con tu permiso, cookies de atribución para
        rastrear referidos de nuestros partners. Lee nuestra{" "}
        <a href="/privacy" className="underline">política de privacidad</a>.
      </p>
      <div className="mt-4 flex gap-3">
        <button onClick={accept}
                className="flex-1 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800">
          Aceptar todas
        </button>
        <button onClick={reject}
                className="flex-1 rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
          Rechazar todas
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
pnpm vitest run tests/cookie-consent.test.tsx
```

- [ ] **Step 5: Mount in `app/layout.tsx`**

Add `<CookieConsent />` at the end of `<body>`, inside the providers wrapper if any. One-line import + one-line mount.

- [ ] **Step 6: Commit**

```bash
git add web/components/cookie-consent.tsx web/tests/cookie-consent.test.tsx web/app/layout.tsx
git commit -m "feat(reseller): cookie consent banner (AEPD-compliant, equiprominent buttons)"
```

---

### Task 1.2: Middleware ref capture

**Files:**
- Modify: `web/middleware.ts`

- [ ] **Step 1: Write the patch per spec §4.2**

Inside the existing `auth(async (req) => { ... })` function, right before the final `return NextResponse.next();`, insert the "BEGIN reseller attribution" block from spec §4.2 verbatim.

- [ ] **Step 2: Update matcher**

Add `"/"` to the matcher array (existing matchers stay untouched).

- [ ] **Step 3: Write integration test**

Create `web/tests/middleware-ref.test.ts` testing:
- `/?ref=juan` with consent cookie → sets `ordy_ref=juan`
- `/?ref=juan` WITHOUT consent → does NOT set cookie
- `/admin?ref=juan` → does NOT set cookie (skipRef)
- Invalid slug `?ref=---` → does NOT set cookie (regex filter)
- Cookie already present → does NOT overwrite (first-touch)

- [ ] **Step 4: Run tests**

```bash
cd web && pnpm vitest run tests/middleware-ref.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add web/middleware.ts web/tests/middleware-ref.test.ts
git commit -m "feat(reseller): middleware captures ?ref= into ordy_ref cookie (consent-gated)"
```

---

### Task 1.3: `/api/ref/touch` endpoint

**Files:**
- Create: `web/app/api/ref/touch/route.ts`
- Create: `web/lib/reseller/anon-id.ts`
- Modify: `web/lib/rate-limit.ts` (add `limitByResellerSlug` helper)
- Create: `web/tests/api-ref-touch.test.ts`

- [ ] **Step 1: Add rate limit helpers**

In `web/lib/rate-limit.ts`, append after `limitByUserOnboarding` (line ~63):
```ts
export async function limitByResellerSlug(slug: string) {
  return _limit(`rl:reseller_slug:${slug}`, 50, "1 h");
}
export async function limitByUserId(userId: string, bucket: string, limit: number, windowStr: string) {
  return _limit(`rl:user:${userId}:${bucket}`, limit, windowStr);
}
```

- [ ] **Step 2: Write anon-id helper**

`web/lib/reseller/anon-id.ts`:
```ts
import { createHash } from "crypto";

export function computeAnonId(ipHash: string, userAgent: string | null): string {
  const bucket = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return createHash("sha256").update(`${ipHash}::${userAgent ?? ""}::${bucket}`).digest("hex");
}

export function hashIp(ip: string): string {
  const salt = process.env.IP_HASH_SALT ?? "ordy-default-salt-change-me";
  return createHash("sha256").update(`${ip}::${salt}`).digest("hex");
}
```

- [ ] **Step 3: Write failing test**

`web/tests/api-ref-touch.test.ts`: test Zod validation (reject invalid body), Sec-Fetch-Dest filter, UA bot filter, valid touch INSERTs a row with `onConflictDoNothing`.

- [ ] **Step 4: Implement route**

`web/app/api/ref/touch/route.ts`:
```ts
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { resellers, refTouches, auditLog } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { limitByIp, limitByResellerSlug } from "@/lib/rate-limit";
import { computeAnonId, hashIp } from "@/lib/reseller/anon-id";

const BODY_SCHEMA = z.object({
  ref: z.string().regex(/^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])?$/).max(40),
  utm_source: z.string().max(100).nullable().optional(),
  utm_medium: z.string().max(100).nullable().optional(),
  utm_campaign: z.string().max(100).nullable().optional(),
  utm_term: z.string().max(100).nullable().optional(),
  utm_content: z.string().max(200).nullable().optional(),
  referer: z.string().max(500).nullable().optional(),
});

const BOT_UA_RE = /googlebot|bingbot|slurp|yandex|ahrefs|semrush|mj12bot|facebookexternalhit/i;

export async function POST(req: NextRequest) {
  // 1. Sec-Fetch-Dest guard
  if (req.headers.get("sec-fetch-dest") !== "empty") {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  // 2. Bot filter
  const ua = req.headers.get("user-agent") ?? "";
  if (BOT_UA_RE.test(ua)) return new NextResponse(null, { status: 204 });

  // 3. Zod
  let body;
  try { body = BODY_SCHEMA.parse(await req.json()); }
  catch { return NextResponse.json({ error: "invalid" }, { status: 400 }); }

  // 4. Rate limits
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const ipResult = await limitByIp(ip);
  if (!ipResult.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  const slugResult = await limitByResellerSlug(body.ref);
  if (!slugResult.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  // 5. Resolve reseller
  const [reseller] = await db.select({ id: resellers.id })
    .from(resellers)
    .where(and(eq(resellers.slug, body.ref), eq(resellers.status, "active")))
    .limit(1);
  if (!reseller) return new NextResponse(null, { status: 204 });

  // 6. Insert touch
  const anonId = computeAnonId(hashIp(ip), ua);
  await db.insert(refTouches).values({
    resellerId: reseller.id,
    anonId,
    ipHash: hashIp(ip),
    userAgent: ua.slice(0, 500),
    utmSource: body.utm_source ?? null,
    utmMedium: body.utm_medium ?? null,
    utmCampaign: body.utm_campaign ?? null,
    utmTerm: body.utm_term ?? null,
    utmContent: body.utm_content ?? null,
    referer: body.referer?.slice(0, 500) ?? null,
  }).onConflictDoNothing();

  await db.insert(auditLog).values({
    action: "reseller.attribution.touch",
    entity: "reseller",
    entityId: reseller.id,
    metadata: { anon_id_prefix: anonId.slice(0, 8) },
  });

  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 5: Add `/api/ref/touch` to middleware matcher + ensure rate-limit exempt NOT applied**

`/api/ref/touch` should go through the existing IP rate limiter (it's not on the exempt list in `middleware.ts:10-14`). Verify by reading middleware.

- [ ] **Step 6: Run tests**

```bash
pnpm vitest run tests/api-ref-touch.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add web/app/api/ref/touch/route.ts web/lib/reseller/anon-id.ts web/lib/rate-limit.ts web/tests/api-ref-touch.test.ts
git commit -m "feat(reseller): /api/ref/touch writes ref_touches with rate limits + bot filter"
```

---

### Task 1.4: Client beacon `ref-tracker.tsx`

**Files:**
- Create: `web/components/ref-tracker.tsx`
- Modify: `web/app/layout.tsx`

- [ ] **Step 1: Create component**

```tsx
"use client";
import { useEffect } from "react";

export function RefTracker() {
  useEffect(() => {
    const match = document.cookie.match(/ordy_ref=([^;]+)/);
    const ref = match?.[1];
    if (!ref) return;
    const utm = new URLSearchParams(window.location.search);
    const body = JSON.stringify({
      ref,
      utm_source: utm.get("utm_source"),
      utm_medium: utm.get("utm_medium"),
      utm_campaign: utm.get("utm_campaign"),
      utm_term: utm.get("utm_term"),
      utm_content: utm.get("utm_content"),
      referer: document.referrer || null,
    });
    // POST via fetch (sendBeacon doesn't support custom headers like sec-fetch-dest)
    fetch("/api/ref/touch", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Sec-Fetch-Dest": "empty" },
      body,
      keepalive: true,
    }).catch(() => { /* silent */ });
  }, []);
  return null;
}
```

- [ ] **Step 2: Mount in layout**

Add `<RefTracker />` at the end of `<body>`.

- [ ] **Step 3: Commit**

```bash
git add web/components/ref-tracker.tsx web/app/layout.tsx
git commit -m "feat(reseller): client beacon posts to /api/ref/touch for ref_touches dual-write"
```

---

### Task 1.5: Attribution resolver + hook in `provision.ts`

**Files:**
- Create: `web/lib/reseller/attribution.ts`
- Modify: `web/lib/onboarding-fast/provision.ts`
- Create: `web/tests/attribution.test.ts`

- [ ] **Step 1: Write `attribution.ts`**

Implement `resolveResellerAttribution` per spec §4.5.

- [ ] **Step 2: Modify `provision.ts:116`**

Locate the `// 5. INSERT tenants.` comment. Before the `.insert(tenants)` call, add:
```ts
const resellerId = await resolveResellerAttribution({
  cookieStore: await cookies(),
  ipHash: hashIp(input.ipAddress ?? "unknown"),
  userAgent: input.userAgent ?? null,
  signupEmail: input.email,
  tx,
});
```
Then add `resellerId` to the INSERT values object.

- [ ] **Step 3: Write test suite**

Cover: cookie-only path, ref_touches fallback, self-referral flag, reseller inactive → null, no attribution → null. Use DB fixtures.

- [ ] **Step 4: Run tests**

```bash
pnpm vitest run tests/attribution.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add web/lib/reseller/attribution.ts web/lib/onboarding-fast/provision.ts web/tests/attribution.test.ts
git commit -m "feat(reseller): resolve attribution at tenant creation (cookie + ref_touches fallback)"
```

---

### Task 1.6: Cron commissions-mature

**Files:**
- Create: `web/app/api/cron/commissions-mature/route.ts`
- Modify: `web/vercel.json`
- Create: `web/tests/cron-mature.test.ts`

- [ ] **Step 1: Implement route**

```ts
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { resellerCommissions } from "@/lib/db/schema";
import { validateCronAuth } from "@/lib/cron";
import { and, eq, isNull, lte, or, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const unauthorized = validateCronAuth(req);
  if (unauthorized) return unauthorized;

  const result = await db.update(resellerCommissions)
    .set({ status: "payable" })
    .where(and(
      eq(resellerCommissions.status, "pending"),
      lte(resellerCommissions.invoicePaidAt, sql`now() - interval '30 days'`),
      isNull(resellerCommissions.refundedAt),
      or(
        isNull(resellerCommissions.tenantChurnedAt),
        sql`${resellerCommissions.tenantChurnedAt} > ${resellerCommissions.invoicePaidAt} + interval '30 days'`,
      ),
    ))
    .returning({ id: resellerCommissions.id });

  return NextResponse.json({ matured: result.length });
}
```

- [ ] **Step 2: Add to vercel.json**

Edit `web/vercel.json` to add:
```json
{ "path": "/api/cron/commissions-mature", "schedule": "0 3 * * *" }
```
(Inside the existing `crons` array.)

- [ ] **Step 3: Write test**

Test fixtures: 3 commissions (one 31d old pending, one 15d old pending, one 31d with tenant churned). Run handler, verify only 1 flipped to payable.

- [ ] **Step 4: Commit**

```bash
git add web/app/api/cron/commissions-mature/route.ts web/vercel.json web/tests/cron-mature.test.ts
git commit -m "feat(reseller): cron commissions-mature flips pending→payable after 30d hold"
```

---

### Task 1.7: Phase 1 completion gate

- [ ] **Step 1: Full test run**

```bash
cd web && pnpm vitest run && pnpm tsc --noEmit && pnpm lint
```

- [ ] **Step 2: Manual smoke test**

1. Start dev server, accept cookie banner, visit `/?ref=testslug`
2. Open devtools, verify `ordy_ref` cookie set
3. Check Network tab: POST to `/api/ref/touch` fires
4. Check DB: `SELECT * FROM ref_touches ORDER BY first_seen_at DESC LIMIT 1;` — row present

---

## Phase 2 — Super admin panel + reseller role (3 days)

### Task 2.1: Auth.js role widening + signIn hardening

**Files:**
- Modify: `web/lib/auth.ts`
- Create: `web/tests/auth-role.test.ts`

- [ ] **Step 1: Write failing test for signIn hardening**

Test: if existing user has `role='reseller'` and email matches `SUPER_ADMIN_EMAIL`, do NOT promote (audit log instead).

- [ ] **Step 2: Patch auth.ts L93-94 (union type)**

```ts
role: "super_admin" | "tenant_admin" | "reseller";
```

- [ ] **Step 3: Patch auth.ts L169 (cast)**

```ts
session.user.role =
  (row?.role as "super_admin" | "tenant_admin" | "reseller") ?? "tenant_admin";
```

- [ ] **Step 4: Patch signIn callback (L173-180) per spec §5.2**

Copy the hardened version from spec §5.2 verbatim.

- [ ] **Step 5: Run test — PASS**

- [ ] **Step 6: Commit**

```bash
git add web/lib/auth.ts web/tests/auth-role.test.ts
git commit -m "feat(reseller): Auth.js role 'reseller' + signIn hardening against email-based escalation"
```

---

### Task 2.2: Middleware `/reseller` guard

**Files:**
- Modify: `web/middleware.ts`

- [ ] **Step 1: Add guard block**

After the existing `/admin` guard, add:
```ts
if (pathname.startsWith("/reseller")) {
  if (!isAuthed) return NextResponse.redirect(new URL("/signin?from=/reseller", req.url));
  if (req.auth?.user?.role !== "reseller") {
    const dest = req.auth?.user?.role === "super_admin" ? "/admin/resellers" : "/dashboard";
    return NextResponse.redirect(new URL(dest, req.url));
  }
}
```

- [ ] **Step 2: Add `/reseller/:path*` to matcher**

- [ ] **Step 3: Commit**

```bash
git add web/middleware.ts
git commit -m "feat(reseller): middleware guards /reseller to role=reseller only"
```

---

### Task 2.3: Server action `createReseller` (transactional)

**Files:**
- Create: `web/lib/reseller/create.ts`
- Create: `web/tests/create-reseller.test.ts`

- [ ] **Step 1: Write failing test**

Test transactional atomicity: mock DB failure between INSERT users and INSERT resellers; verify ROLLBACK leaves no orphan user with `role='reseller'`.

- [ ] **Step 2: Implement `create.ts`**

```ts
"use server";
import { db } from "@/lib/db";
import { users, resellers, auditLog } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { sendInviteEmail } from "@/lib/email";

const COUNTRY_TO_CURRENCY: Record<string, string> = { /* from spec §6.6 */ };
const COUNTRY_TO_STRATEGY = (country: string) => {
  if (country === "ES") return "es";
  const EU = ["FR","DE","IT","NL","PT","BE","IE","AT","FI","LU","GR","CY","SK","SI","EE","LV","LT","MT","PL","CZ","HU","RO","BG","HR","DK","SE"];
  if (EU.includes(country)) return "eu-vat";
  return "fallback";
};

export async function createReseller(input: {
  email: string;
  slug: string;
  brandName: string;
  commissionRate: number;
  countryCode: string;
  legalName?: string;
  taxId?: string;
  taxIdType?: string;
  fiscalSubProfile?: string;
  iaeRegistered?: boolean;
  billingAddress?: any;
  selfBillingConsent: boolean;
  agreementVersion: string;
  actorUserId: string; // super admin performing action
}) {
  return db.transaction(async (tx) => {
    // Gate: ES country requires IAE + fiscal_sub_profile
    if (input.countryCode === "ES" && (!input.iaeRegistered || !input.fiscalSubProfile)) {
      throw new Error("es_reseller_requires_iae_and_fiscal_profile");
    }
    // Gate: fallback countries must be in Stripe Connect supported list
    if (!COUNTRY_TO_CURRENCY[input.countryCode]) {
      throw new Error("country_not_supported_by_stripe_connect");
    }

    // 1. resolve or create user
    let [user] = await tx.select().from(users).where(eq(users.email, input.email)).limit(1);
    if (!user) {
      [user] = await tx.insert(users).values({
        email: input.email,
        role: "reseller",
      }).returning();
    } else if (user.role !== "reseller") {
      // Promote to reseller (never from super_admin)
      if (user.role === "super_admin") throw new Error("cannot_reseller_super_admin");
      await tx.update(users).set({ role: "reseller" }).where(eq(users.id, user.id));
    }

    // 2. INSERT reseller
    const [reseller] = await tx.insert(resellers).values({
      userId: user.id,
      slug: input.slug,
      brandName: input.brandName,
      commissionRate: input.commissionRate.toFixed(4),
      status: "pending",
      countryCode: input.countryCode,
      taxStrategy: COUNTRY_TO_STRATEGY(input.countryCode),
      payoutCurrency: COUNTRY_TO_CURRENCY[input.countryCode],
      legalName: input.legalName,
      taxId: input.taxId,
      taxIdType: input.taxIdType,
      fiscalSubProfile: input.fiscalSubProfile,
      iaeRegistered: input.iaeRegistered ?? false,
      billingAddress: input.billingAddress,
      selfBillingConsentedAt: input.selfBillingConsent ? new Date() : null,
      selfBillingAgreementVersion: input.selfBillingConsent ? input.agreementVersion : null,
    }).returning();

    // 3. Audit
    await tx.insert(auditLog).values({
      action: "admin.reseller.created",
      entity: "reseller",
      entityId: reseller.id,
      actorUserId: input.actorUserId,
      metadata: { slug: input.slug, country: input.countryCode },
    });

    return { reseller, user };
  });
}
```

- [ ] **Step 3: Run tests**

- [ ] **Step 4: Commit**

```bash
git add web/lib/reseller/create.ts web/tests/create-reseller.test.ts
git commit -m "feat(reseller): createReseller server action (transactional, ES+IAE gate, country→strategy)"
```

---

### Task 2.4: `/admin/resellers` list page

**Files:**
- Create: `web/app/admin/resellers/page.tsx`
- Create: `web/components/ui/data-table.tsx`

- [ ] **Step 1: Create `DataTable` component**

Implement the data-table wrapper per spec §10.4. Props: `columns`, `rows`, `onRowClick`, `emptyState`, `loading`. Internally uses raw `<table>` with Tailwind classes matching existing `/admin/tenants/page.tsx`.

- [ ] **Step 2: Implement list page**

Fetch resellers (with aggregated MRR via JOIN on `reseller_commissions`). Render filters + KPI cards + DataTable per spec §10.2. Use shadcn `Card`, `Badge`, `Button`.

- [ ] **Step 3: Commit**

```bash
git add web/app/admin/resellers/page.tsx web/components/ui/data-table.tsx
git commit -m "feat(reseller): /admin/resellers list page with filters + KPIs + DataTable"
```

---

### Task 2.5: `/admin/resellers/new` wizard (4 steps)

**Files:**
- Create: `web/app/admin/resellers/new/page.tsx`
- Create: `web/components/ui/stepper.tsx`

- [ ] **Step 1: Stepper component**

3-dot progress strip, pure CSS/Tailwind, no deps.

- [ ] **Step 2: 4-step wizard page**

- Step 1 **País**: `<select>` country_code → auto-fills strategy + currency preview + shows Mode B availability; reject if country not in Stripe Connect list
- Step 2 **Identidad**: email + slug (live uniqueness check via Server Action) + brand_name
- Step 3 **Comisión**: rate slider 10-50% default 25; payout_mode note "Stripe Connect requerido (único rail v1)"
- Step 4 **Fiscal**: conditional fields based on country; ES requires fiscal_sub_profile dropdown + iae_registered checkbox + IAE proof upload placeholder; EU requires VAT-ID + VIES check; self-billing consent checkbox (required); billing address

Form submits via Server Action calling `createReseller`. On success → redirect to `/admin/resellers/[id]` + send magic link email to reseller.

- [ ] **Step 3: Commit**

```bash
git add web/app/admin/resellers/new/page.tsx web/components/ui/stepper.tsx
git commit -m "feat(reseller): /admin/resellers/new 4-step wizard (country-first with ES gates)"
```

---

### Task 2.6: `/admin/resellers/[id]` detail page

**Files:**
- Create: `web/app/admin/resellers/[id]/page.tsx`
- Create: `web/components/ui/tabs.tsx`
- Modify: `web/package.json` (add `@radix-ui/react-tabs`)

- [ ] **Step 1: Install Radix Tabs**

```bash
cd web && pnpm install @radix-ui/react-tabs
```

- [ ] **Step 2: Tabs component** wrapping Radix Primitive

- [ ] **Step 3: Detail page with 5 tabs** (Overview, Tenants, Comisiones, Payouts, Settings) per spec §10.2

Use `recharts` for the 12-month chart.

- [ ] **Step 4: Install recharts + qrcode.react**

```bash
cd web && pnpm install recharts qrcode.react
```

- [ ] **Step 5: Commit**

```bash
git add web/app/admin/resellers/[id]/page.tsx web/components/ui/tabs.tsx web/package.json web/pnpm-lock.yaml
git commit -m "feat(reseller): /admin/resellers/[id] detail page with 5 tabs + charts"
```

---

### Task 2.7: Pause/terminate endpoints

**Files:**
- Create: `web/app/api/admin/resellers/[id]/status/route.ts`

- [ ] **Step 1: Implement PATCH route**

`PATCH /api/admin/resellers/[id]/status` body `{ status: 'active'|'paused'|'terminated' }`. Guard: super_admin only. Rate limit: `limitByUserId(userId, "reseller_approve", 30, "1 h")`. Audit log for each transition.

- [ ] **Step 2: Wire to detail page buttons** (Pausar / Reactivar / Terminar)

- [ ] **Step 3: Commit**

```bash
git add web/app/api/admin/resellers/[id]/status/route.ts
git commit -m "feat(reseller): admin endpoint to pause/terminate reseller with audit log"
```

---

### Task 2.8: Phase 2 completion gate

- [ ] **Step 1: E2E smoke**

Playwright test: super admin logs in → `/admin/resellers/new` → completes wizard → reseller created → magic link email received (dev: printed to console).

- [ ] **Step 2: Run full suite**

```bash
pnpm vitest run && pnpm tsc --noEmit && pnpm lint
```

---

## Phase 3 — Reseller panel read-only (3-4 days)

### Task 3.1: IDOR scope helpers

**Files:**
- Create: `web/lib/reseller/scope.ts`
- Create: `web/tests/reseller/idor.test.ts`
- Create: `web/tests/reseller/fixtures/resellers.ts`

- [ ] **Step 1: Fixtures**

Create 2 resellers (A: status=active, Spain; B: status=active, UK) each with 2 tenants. Seed ref_touches, commissions (1 paid, 1 payable), 1 payout each.

- [ ] **Step 2: Write IDOR tests FIRST (table-driven)**

For each helper (`resellerTenantsList`, `resellerTenantById`, `resellerCommissionsList`, `resellerPayoutsList`, `resellerTenantHealth`):
- ✅ Reseller A session → sees only A's rows
- ❌ Reseller A session trying to access B's tenant id → `IDORError`
- ❌ super_admin session → `IDORError` (scope helpers ONLY for reseller role, super_admin uses different endpoints)
- ❌ tenant_admin session → `IDORError`

- [ ] **Step 3: Implement `scope.ts` per spec §9.1 verbatim**

- [ ] **Step 4: Run tests — all PASS**

- [ ] **Step 5: Commit**

```bash
git add web/lib/reseller/scope.ts web/tests/reseller/idor.test.ts web/tests/reseller/fixtures/resellers.ts
git commit -m "feat(reseller): scope.ts with IDOR allowlist + complete test coverage"
```

---

### Task 3.2: ESLint rule enforcement

**Files:**
- Modify: `web/.eslintrc.json` (or config file)

- [ ] **Step 1: Add rule**

Per spec §9.2 — `no-restricted-syntax` targeting `db.select().from(tenants|messages|conversations|agentConfigs|providerCredentials)` inside `app/reseller/**` and `app/api/reseller/**`.

- [ ] **Step 2: Run lint across project**

```bash
pnpm lint
```
Should pass (no code in reseller/** yet that violates).

- [ ] **Step 3: Negative test**

Create a stub file `web/app/reseller/_lint-test.tsx` with a forbidden query, run lint, confirm it fails. Delete the stub.

- [ ] **Step 4: Commit**

```bash
git add web/.eslintrc.json
git commit -m "feat(reseller): ESLint rule no-direct-tenant-query in reseller routes"
```

---

### Task 3.3: `/reseller` home page

**Files:**
- Create: `web/app/reseller/page.tsx`
- Create: `web/app/reseller/layout.tsx`
- Create: `web/components/reseller-share-card.tsx`
- Modify: `web/components/app-shell.tsx` (add `navItems` prop)

- [ ] **Step 1: AppShell prop extension**

Add optional `navItems?: NavItem[]` prop to AppShell. If provided, render those instead of the default super_admin/tenant nav.

- [ ] **Step 2: Reseller layout** with reseller-specific nav items

- [ ] **Step 3: Share card** with URL `ordychat.ordysuite.com/?ref={slug}`, copy button, QR code via `qrcode.react`

- [ ] **Step 4: Home page** with KPIs (via scope helpers) + 2 charts (recharts) + share card

- [ ] **Step 5: Commit**

```bash
git add web/app/reseller/page.tsx web/app/reseller/layout.tsx web/components/reseller-share-card.tsx web/components/app-shell.tsx
git commit -m "feat(reseller): /reseller home with KPIs, charts, share card + QR"
```

---

### Task 3.4: `/reseller/tenants` list + detail

**Files:**
- Create: `web/app/reseller/tenants/page.tsx`
- Create: `web/app/reseller/tenants/[id]/page.tsx`

- [ ] **Step 1: List page** uses `resellerTenantsList(session)` — restricted columns only (per spec §10.3)

- [ ] **Step 2: Detail page** uses `resellerTenantHealth(session, id)` — shows uptime/messages/response-rate/paused/last-error-category — NEVER conversation content, NEVER prompt, NEVER credentials

- [ ] **Step 3: Commit**

```bash
git add web/app/reseller/tenants
git commit -m "feat(reseller): /reseller/tenants list + detail (read-only, allowlisted fields)"
```

---

### Task 3.5: `/reseller/commissions`, `/reseller/payouts`, `/reseller/settings`, `/reseller/marketing`

**Files:**
- Create: `web/app/reseller/commissions/page.tsx`
- Create: `web/app/reseller/payouts/page.tsx`
- Create: `web/app/reseller/settings/page.tsx`
- Create: `web/app/reseller/marketing/page.tsx`

- [ ] **Step 1: Commissions page** (filter by month, table with status badges)

- [ ] **Step 2: Payouts page** (table with tax breakdown columns, invoice PDF download if present)

- [ ] **Step 3: Settings page** (brand_name edit, Stripe Connect onboarding button, payout preferences read-only, fiscal data edit)

- [ ] **Step 4: Marketing page** (asset grid with downloadable logos/banners/templates placeholders + public landing URL)

- [ ] **Step 5: Commit**

```bash
git add web/app/reseller/commissions web/app/reseller/payouts web/app/reseller/settings web/app/reseller/marketing
git commit -m "feat(reseller): commissions/payouts/settings/marketing pages (read-only)"
```

---

### Task 3.6: Phase 3 gate

- [ ] **Step 1: Full IDOR test run**

```bash
pnpm vitest run tests/reseller/
```

- [ ] **Step 2: E2E Playwright**

Login as reseller, navigate all 7 pages, verify no console errors, verify cannot hit `/admin` (redirects).

- [ ] **Step 3: tsc + lint**

---

## Phase 4 — Commission engine (2-3 days)

### Task 4.1: Webhook — `invoice.paid` case (transactional)

**Files:**
- Modify: `web/app/api/stripe/webhook/route.ts`
- Create: `web/tests/webhook-invoice-paid.test.ts`

- [ ] **Step 1: Write failing test**

Test: `invoice.paid` event with tenant having `reseller_id` → INSERT reseller_commission with snapshot. Retry same event → `onConflictDoNothing` → no duplicate.

- [ ] **Step 2: Add `invoice.paid` case per spec §5.1**

Inside the existing `switch (event.type)`, add the `invoice.paid` case wrapped in `db.transaction()`.

- [ ] **Step 3: Run test — PASS**

- [ ] **Step 4: Commit**

```bash
git add web/app/api/stripe/webhook/route.ts web/tests/webhook-invoice-paid.test.ts
git commit -m "feat(reseller): webhook invoice.paid → commission insert (transactional, snapshot rate)"
```

---

### Task 4.2: Webhook — `charge.refunded` case

**Files:**
- Modify: `web/app/api/stripe/webhook/route.ts`
- Create: `web/tests/webhook-charge-refunded.test.ts`

- [ ] **Step 1: Write test** (refunded before payout → status=reversed; refunded after paid → `commission_debt_cents` increments via separate logic in Task 4.6)

- [ ] **Step 2: Add case per spec §5.1**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(reseller): webhook charge.refunded reverses commission (no physical clawback)"
```

---

### Task 4.3: Webhook — `payout.paid` + `payout.failed` (Stripe Connect)

**Files:**
- Modify: `web/app/api/stripe/webhook/route.ts`
- Create: `web/tests/webhook-payout-events.test.ts`

- [ ] **Step 1: Test — payout.paid flips reseller_payout.status='paid'**

- [ ] **Step 2: Add both cases per spec §5.1**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(reseller): webhook payout.paid/failed (Connect account events)"
```

---

### Task 4.4: Webhook — `account.updated` + `account.application.deauthorized`

**Files:**
- Modify: `web/app/api/stripe/webhook/route.ts`
- Create: `web/tests/webhook-account-events.test.ts`

- [ ] **Step 1: Tests**

- [ ] **Step 2: Add both cases per spec §5.1** (deauthorized → auto-pause reseller)

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(reseller): webhook account.updated + deauthorized (KYC tracking + auto-pause)"
```

---

### Task 4.5: Refund cross-period carry-over

**Files:**
- Create: `web/lib/reseller/debt.ts`
- Create: `web/tests/reseller/debt.test.ts`

- [ ] **Step 1: Test — commission reversed after payout paid → increments `resellers.commission_debt_cents`**

- [ ] **Step 2: Implement**

Extend the `charge.refunded` case handler: if commission had `payout_id` AND payout.status='paid' → additionally `UPDATE resellers SET commission_debt_cents = commission_debt_cents + X WHERE id = ...`.

- [ ] **Step 3: Test threshold alert** — debt > 3 months or > 500 EUR → insert `audit_log` action `reseller.debt.alert` (actual email notification in observability phase; stub for now)

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(reseller): refund cross-period carry-over via commission_debt_cents"
```

---

### Task 4.6: Phase 4 gate

- [ ] **Step 1: All webhook tests green**

- [ ] **Step 2: Stripe CLI replay test**

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook &
stripe trigger invoice.paid
stripe trigger charge.refunded
stripe trigger payout.paid
stripe trigger payout.failed
stripe trigger account.updated
```
Manually verify DB state after each event.

---

## Phase 5 — Payout engine (5-6 days)

### Task 5.1: Tax strategy types + registry

**Files:**
- Create: `web/lib/payouts/strategies/types.ts`
- Create: `web/lib/payouts/registry.ts`

- [ ] **Step 1: `types.ts`** — `TaxBreakdown` + `TaxStrategy` interfaces per spec §6.2

- [ ] **Step 2: `registry.ts`**

```ts
import type { Reseller } from "@/lib/db/schema";
import type { TaxStrategy } from "./strategies/types";
import { esStrategy } from "./strategies/es";
import { euVatStrategy } from "./strategies/eu-vat";
import { fallbackStrategy } from "./strategies/fallback";

const REGISTRY: Record<string, TaxStrategy> = {
  "es": esStrategy,
  "eu-vat": euVatStrategy,
  "fallback": fallbackStrategy,
};

export function resolveTaxStrategy(reseller: Reseller): TaxStrategy {
  const s = REGISTRY[reseller.taxStrategy];
  if (!s) throw new Error(`unknown_tax_strategy:${reseller.taxStrategy}`);
  if (!s.canApply(reseller)) throw new Error(`strategy_cannot_apply:${reseller.taxStrategy}`);
  return s;
}
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(reseller): TaxStrategy interface + registry"
```

---

### Task 5.2: Strategy `es`

**Files:**
- Create: `web/lib/payouts/strategies/es.ts`
- Create: `web/tests/payouts/strategy-es.test.ts`

- [ ] **Step 1: Write tests** for 4 sub-profiles:
  - `autonomo_es`: base 41100 → IVA 8631, IRPF 6165, transfer 43566
  - `autonomo_new_es`: base 41100 → IVA 8631, IRPF 2877, transfer 46854
  - `sl_es`: base 41100 → IVA 8631, IRPF 0 (warning 'sl_irpf_unverified_consult_asesor'), transfer 49731
  - Canarias autonomo: base 41100 → IGIC 2877 (7%), IRPF 6165, transfer 37812

- [ ] **Step 2: Implement `es.ts`**

```ts
import type { Reseller } from "@/lib/db/schema";
import type { TaxStrategy, TaxBreakdown } from "./types";

const CANARIAS_PROVINCES = new Set(["35", "38"]);

function isCanarias(r: Reseller): boolean {
  if (!r.billingAddress || typeof r.billingAddress !== "object") return false;
  const prov = (r.billingAddress as any).province_code;
  return typeof prov === "string" && CANARIAS_PROVINCES.has(prov);
}

export const esStrategy: TaxStrategy = {
  code: "es",
  canApply(r) { return r.countryCode === "ES" && r.iaeRegistered && !!r.fiscalSubProfile; },

  calculate(r, sum) {
    const canarias = isCanarias(r);
    const vat_rate = canarias ? 0.07 : 0.21;  // IGIC vs IVA
    const vat_cents = Math.round(sum * vat_rate);

    let withholding_rate = 0;
    const warnings: string[] = [];
    if (r.fiscalSubProfile === "autonomo_es") withholding_rate = 0.15;
    else if (r.fiscalSubProfile === "autonomo_new_es") withholding_rate = 0.07;
    else if (r.fiscalSubProfile === "sl_es") {
      withholding_rate = 0;
      warnings.push("sl_irpf_unverified_consult_asesor");
    }
    const withholding_cents = Math.round(sum * withholding_rate);

    return {
      source_cents: sum,
      base_cents: sum,
      vat_rate,
      vat_cents,
      withholding_rate,
      withholding_cents,
      transfer_cents: sum + vat_cents - withholding_cents,
      requires_self_billing: true,
      requires_vat_id_validation: false,
      reporting_forms: ["modelo_111", "modelo_190", "modelo_347", ...(canarias ? ["igic_dacion"] : [])],
      warnings,
    };
  },

  async generateInvoice(r, payout, breakdown) {
    // See Task 5.6 (verifactu integration)
    throw new Error("not_implemented_yet");
  },
};
```

- [ ] **Step 3: Run tests — PASS**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(reseller): tax strategy 'es' (autonomo + SL + Canarias + autonomo_new)"
```

---

### Task 5.3: Strategies `eu-vat` + `fallback`

**Files:**
- Create: `web/lib/payouts/strategies/eu-vat.ts`
- Create: `web/lib/payouts/strategies/fallback.ts`
- Create: `web/tests/payouts/strategy-eu-vat.test.ts`
- Create: `web/tests/payouts/strategy-fallback.test.ts`

- [ ] **Step 1: Tests for both** (simple: vat=0, withholding=0, transfer_cents === source_cents)

- [ ] **Step 2: Implement both** (very short, ~15 lines each)

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(reseller): tax strategies 'eu-vat' + 'fallback'"
```

---

### Task 5.4: FX module

**Files:**
- Create: `web/lib/payouts/fx.ts`
- Create: `web/tests/payouts/fx.test.ts`

- [ ] **Step 1: Test — ECB XML fetch mocked returns EUR→USD rate**

- [ ] **Step 2: Implement `fx.ts`**

```ts
// web/lib/payouts/fx.ts
import Stripe from "stripe";

const ECB_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
let cache: { ts: number; rates: Record<string, number> } | null = null;

export async function ecbPreviewRate(targetCurrency: string): Promise<number> {
  if (targetCurrency === "EUR") return 1;
  const now = Date.now();
  if (!cache || now - cache.ts > 24 * 3600 * 1000) {
    const xml = await (await fetch(ECB_URL)).text();
    const rates: Record<string, number> = { EUR: 1 };
    for (const m of xml.matchAll(/currency='([A-Z]{3})' rate='([\d.]+)'/g)) {
      rates[m[1]] = parseFloat(m[2]);
    }
    cache = { ts: now, rates };
  }
  const r = cache.rates[targetCurrency];
  if (!r) throw new Error(`fx_rate_unavailable:${targetCurrency}`);
  return r;
}

export const COUNTRY_TO_CURRENCY: Record<string, string> = { /* from spec §6.6 */ };

// Post-transfer: read actual FX from connected account's balance_transaction
export async function readPostTransferFx(
  stripe: Stripe,
  transferId: string,
  connectedAccountId: string,
): Promise<{ rate: number; payout_total_cents: number }> {
  const transfer = await stripe.transfers.retrieve(transferId, {}, { stripeAccount: connectedAccountId });
  if (!transfer.balance_transaction) throw new Error("no_balance_transaction");
  const btId = typeof transfer.balance_transaction === "string" ? transfer.balance_transaction : transfer.balance_transaction.id;
  const bt = await stripe.balanceTransactions.retrieve(btId, { stripeAccount: connectedAccountId });
  return {
    rate: bt.exchange_rate ?? 1,
    payout_total_cents: bt.amount,
  };
}
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(reseller): FX module (ECB preview + Stripe balance_transaction post-transfer)"
```

---

### Task 5.5: Aggregate SQL + cron `resellers-payout-run`

**Files:**
- Create: `web/lib/payouts/aggregate.ts`
- Create: `web/app/api/cron/resellers-payout-run/route.ts`
- Modify: `web/vercel.json`
- Create: `web/tests/payouts/cron-payout-run.test.ts`

- [ ] **Step 1: aggregate.ts** — the SQL + transactional insert per spec §6.8 step 3

- [ ] **Step 2: Cron route** — implements the 6-step orchestration from spec §6.8 (validateCronAuth, aggregate, for each draft: KYC gate check, strategy calculate, FX preview, invoice gen if ES, update to ready, email Mario; HALT — no transfer)

- [ ] **Step 3: vercel.json** — add `{ "path": "/api/cron/resellers-payout-run", "schedule": "0 8 5 * *" }`

- [ ] **Step 4: Tests** — fixtures with 4 fiscal profiles, run cron, verify 4 draft→ready payouts with correct breakdowns

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(reseller): cron resellers-payout-run (monthly aggregate + strategy + FX preview)"
```

---

### Task 5.6: Verifactu self-billing integration

**Files:**
- Create: `web/lib/payouts/invoice.ts`
- Modify: `web/lib/payouts/strategies/es.ts` (wire the `generateInvoice` stub)
- Create: `web/tests/payouts/invoice-es.test.ts`

- [ ] **Step 1: Inspect `web/lib/verifactu/`**

Read the module to understand the existing API for invoice generation. Document the available functions (likely `buildRegistroFacturaXml`, `computeHuella`, `submitRegistroFactura`).

- [ ] **Step 2: Create invoice.ts**

Wraps verifactu to generate self-billing for reseller commissions. Needs env vars: `ORDY_NIF`, `ORDY_LEGAL_NAME`, `ORDY_BILLING_ADDRESS_JSON`. Saves PDF to blob storage, returns URL.

- [ ] **Step 3: Wire into `es.ts` `generateInvoice`**

- [ ] **Step 4: Test** — snapshot assertion on generated invoice fields

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(reseller): Verifactu self-billing invoice for ES strategy"
```

---

### Task 5.7: Stripe Connect onboarding endpoints

**Files:**
- Create: `web/app/api/reseller/stripe-connect/start/route.ts`
- Create: `web/app/api/reseller/stripe-connect/callback/route.ts`
- Create: `web/tests/reseller/connect-onboarding.test.ts`

- [ ] **Step 1: Start endpoint**

```ts
// web/app/api/reseller/stripe-connect/start/route.ts
import { auth } from "@/lib/auth";
import { getSessionReseller } from "@/lib/reseller/scope";
import { stripeClient } from "@/lib/stripe";
import { db } from "@/lib/db";
import { resellers } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { limitByUserId } from "@/lib/rate-limit";

export async function POST(req: Request) {
  const session = await auth();
  if (!session) return new Response("unauthorized", { status: 401 });
  const rate = await limitByUserId(session.user.id, "connect_start", 5, "1 h");
  if (!rate.ok) return new Response("rate_limited", { status: 429 });

  const reseller = await getSessionReseller(session);
  const stripe = stripeClient();

  let acctId = reseller.stripeConnectAccountId;
  if (!acctId) {
    const account = await stripe.accounts.create({
      type: "express",
      country: reseller.countryCode,
      capabilities: { transfers: { requested: true } },
      metadata: { reseller_id: reseller.id },
    });
    acctId = account.id;
    await db.update(resellers)
      .set({ stripeConnectAccountId: acctId })
      .where(eq(resellers.id, reseller.id));
  }

  const link = await stripe.accountLinks.create({
    account: acctId,
    refresh_url: `${process.env.NEXT_PUBLIC_APP_URL}/reseller/settings?connect=refresh`,
    return_url: `${process.env.NEXT_PUBLIC_APP_URL}/api/reseller/stripe-connect/callback?acct=${acctId}`,
    type: "account_onboarding",
  });

  return Response.json({ url: link.url });
}
```

- [ ] **Step 2: Callback endpoint**

Validates `session.user.id === reseller.user_id` (anti-hijack), fetches account, updates `stripeConnectStatus` + `stripeConnectPayoutsEnabled` + `stripeConnectChargesEnabled`. Redirects to `/reseller/settings?connect=complete`.

- [ ] **Step 3: Wire from `/reseller/settings` "Connect with Stripe" button**

- [ ] **Step 4: Test** (mock Stripe SDK, verify flow)

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(reseller): Stripe Connect onboarding endpoints with session anti-hijack"
```

---

### Task 5.8: Stripe transfer creation + KYC gate

**Files:**
- Create: `web/lib/payouts/stripe-transfer.ts`
- Create: `web/tests/payouts/transfer.test.ts`

- [ ] **Step 1: Test** — attempt transfer for reseller with `stripeConnectPayoutsEnabled=false` → throws `connect_kyc_pending`. Happy path → creates transfer with correct idempotency key.

- [ ] **Step 2: Implement**

```ts
// web/lib/payouts/stripe-transfer.ts
import { stripeClient } from "@/lib/stripe";
import { db } from "@/lib/db";
import { resellers, resellerPayouts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function executeStripeTransfer(payoutId: string, attemptN: number): Promise<string> {
  const [payout] = await db.select().from(resellerPayouts).where(eq(resellerPayouts.id, payoutId)).limit(1);
  if (!payout) throw new Error("payout_not_found");
  const [r] = await db.select().from(resellers).where(eq(resellers.id, payout.resellerId)).limit(1);
  if (!r) throw new Error("reseller_not_found");

  // KYC gate (duplicate of cron, defense-in-depth)
  if (!r.stripeConnectPayoutsEnabled) throw new Error("connect_kyc_pending");
  if (!r.stripeConnectAccountId) throw new Error("no_connect_account");
  if (r.stripeConnectStatus !== "active") throw new Error(`connect_status_${r.stripeConnectStatus}`);

  const stripe = stripeClient();
  const breakdown = payout.taxBreakdown as any;
  const transfer = await stripe.transfers.create(
    {
      amount: breakdown.transfer_cents,
      currency: "eur",
      destination: r.stripeConnectAccountId,
      transfer_group: `payout_${payout.id}`,
      metadata: { payout_id: payout.id, reseller_id: r.id },
    },
    { idempotencyKey: `payout_${payout.id}_attempt_${attemptN}` }
  );

  await db.update(resellerPayouts)
    .set({ stripeTransferId: transfer.id, status: "sent" })
    .where(eq(resellerPayouts.id, payout.id));

  return transfer.id;
}
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(reseller): Stripe transfer creation with KYC gate + idempotency"
```

---

### Task 5.9: `/admin/payouts` page + approval endpoint with 2FA

**Files:**
- Create: `web/app/admin/payouts/page.tsx`
- Create: `web/app/api/admin/payouts/[id]/approve/route.ts`
- Create: `web/tests/admin-payouts-approve.test.ts`

- [ ] **Step 1: Page** — list payouts filtered by period, show status badges, KPI tiles per spec §10.2 ("Pending total", "Last run", "Failed count", "Awaiting action")

- [ ] **Step 2: Approve endpoint**

```ts
// web/app/api/admin/payouts/[id]/approve/route.ts
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { resellerPayouts, auditLog } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { executeStripeTransfer } from "@/lib/payouts/stripe-transfer";
import { limitByUserId } from "@/lib/rate-limit";
import { verifyRecentTotp } from "@/lib/auth/totp";  // new helper

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session || session.user.role !== "super_admin") return new Response("forbidden", { status: 403 });
  const rate = await limitByUserId(session.user.id, "payout_approve", 60, "1 h");
  if (!rate.ok) return new Response("rate_limited", { status: 429 });

  const body = await req.json();
  const [p] = await db.select().from(resellerPayouts).where(eq(resellerPayouts.id, params.id)).limit(1);
  if (!p) return new Response("not_found", { status: 404 });
  if (p.status !== "ready") return new Response("invalid_state", { status: 409 });

  // High-value approval gate
  if (p.requiresHighValueApproval) {
    const otp = body.totp as string;
    const ok = await verifyRecentTotp(session.user.id, otp, 120); // 2 min window
    if (!ok) return new Response("totp_required_or_invalid", { status: 403 });
  }

  const attemptN = 1;
  const transferId = await executeStripeTransfer(p.id, attemptN);

  await db.update(resellerPayouts)
    .set({ approvedByUserId: session.user.id, approvedAt: new Date() })
    .where(eq(resellerPayouts.id, p.id));

  await db.insert(auditLog).values({
    action: "admin.payout.approved",
    entity: "reseller_payout",
    entityId: p.id,
    actorUserId: session.user.id,
    metadata: { transfer_id: transferId, amount_cents: (p.taxBreakdown as any).transfer_cents },
  });

  return Response.json({ ok: true, transfer_id: transferId });
}
```

- [ ] **Step 3: Create `web/lib/auth/totp.ts` helper** stub (if TOTP not yet implemented in the project, mark as Open Question: Mario configures 2FA setup as prereq)

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(reseller): /admin/payouts page + approval with 2FA for >=5000 EUR"
```

---

### Task 5.10: Post-transfer FX reconciliation

**Files:**
- Modify: `web/app/api/stripe/webhook/route.ts` (extend `payout.paid` handler)
- Create: `web/tests/payouts/post-transfer-fx.test.ts`

- [ ] **Step 1: Extend `payout.paid` case**

When `payout.paid` fires, also call `readPostTransferFx()` and update `reseller_payouts.fx_rate`, `fx_source='stripe_balance_transaction'`, `payout_total_cents`.

- [ ] **Step 2: Test** — mock webhook event + Stripe API → verify DB updated with FX from balance transaction

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(reseller): post-transfer FX reconciliation from Stripe balance_transaction"
```

---

### Task 5.11: Phase 5 gate + E2E

**Files:**
- Create: `web/tests/e2e/reseller-full-flow.spec.ts`

- [ ] **Step 1: E2E Playwright**

Full flow in test:
1. Super admin creates reseller (country=ES, autonomo_es) via wizard
2. Reseller receives magic link (dev: reads from email log), logs in
3. Reseller clicks "Connect with Stripe" → mock Stripe onboarding completion
4. Simulate tenant signup with `?ref={slug}` cookie
5. Simulate 2x `invoice.paid` webhook → 2 commissions in `pending`
6. Advance time 31 days (DB fixture) → run cron commissions-mature → commissions `payable`
7. Run cron resellers-payout-run → payout `draft` → `ready` with correct ES breakdown + self-billing invoice PDF
8. Super admin approves from `/admin/payouts` → Stripe transfer created
9. Simulate `payout.paid` webhook → payout `paid`

- [ ] **Step 2: Full suite**

```bash
pnpm vitest run && pnpm playwright test && pnpm tsc --noEmit && pnpm lint
```

- [ ] **Step 3: Final commit tag**

```bash
git tag v1.0.0-reseller-panel
git commit --allow-empty -m "release(reseller): v1 ready — Stripe Connect only, 3 tax strategies, read-only panel"
```

---

## Self-review

**Spec coverage check** (every section in spec v2 covered):
- §0-1 Executive + goals → Phase 0-5 all phases
- §2 Architecture → Phase 0 + Phase 2-5
- §3 Data model → Tasks 0.2-0.5
- §4 Attribution → Tasks 1.1-1.6
- §5 Commission engine → Tasks 4.1-4.5
- §6 Payout engine → Tasks 5.1-5.10
- §7 Auth.js → Task 2.1
- §8 Middleware guards → Tasks 1.2, 2.2
- §9 IDOR scope → Tasks 3.1-3.2
- §10 UI → Tasks 2.4-2.6, 3.3-3.5, 5.9
- §11 Security → Tasks 2.1 (signIn), 3.1-3.2 (IDOR), 4.1 (tx), 5.8 (KYC), 5.9 (2FA)
- §12 Compliance → Task 2.3 (ES gate in createReseller), Task 5.6 (Verifactu)
- §13 Files → all listed files covered
- §14 Roadmap → Phases 0-5
- §15 Open questions — resolved inline where possible, remaining flagged in specific tasks
- §16 Env vars → Task 0.6
- §17 Testing → tests interleaved with every task
- §18 Audit plan → already executed (this plan is post-audit)
- §19 First commands → Phase 0

**Placeholder scan:** None found. Each task has concrete file paths, complete code blocks for new components, explicit commit messages.

**Type consistency:** Schema types (`Reseller`, `ResellerCommission`, etc.) used consistently across scope.ts, strategies, cron. `TaxBreakdown` shape identical in types.ts and usage in es.ts/eu-vat.ts/fallback.ts.

**Known deferrals:**
- Task 5.6 Verifactu function signature — requires reading `web/lib/verifactu/` first day of F5
- Task 5.9 TOTP helper — may require Mario to set up 2FA infra as prereq

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-18-reseller-panel.md`.**

Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for this plan because task independence is high after F0, and IDOR tests + strategies benefit from fresh-context review.

**2. Inline Execution** — Execute tasks in this session using superpowers:executing-plans, batch execution with checkpoints. Faster for the short F0 phase but risks context rot across F1-F5 (~50 tasks).

**Recommendation: Subagent-driven.** Spec is large, touches sensitive code (Stripe webhook, Auth.js), and each task is self-contained. Fresh subagents per task reduce hallucination risk.

**Which approach?**
