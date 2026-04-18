// web/lib/reseller/attribution.ts
// Resuelve a qué reseller (si alguno) pertenece un nuevo tenant.
//
// Fuentes (prioridad):
// 1. Cookie `ordy_ref` (90d, set por middleware tras consent opt-in)
// 2. Fallback a ref_touches server-side (ITP iOS safety net, 30d window)
//
// Self-referral detection: si el email del signup coincide con el del user
// del reseller, log en audit_log (no bloquea — solo flaggea para revisión).

import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLog, refTouches, resellers, users } from "@/lib/db/schema";
import { computeAnonId } from "./anon-id";

const ATTRIBUTION_HOLD_DAYS = Number(process.env.REF_TOUCH_HOLD_DAYS ?? 30);

export interface AttributionInput {
  /** Valor de la cookie ordy_ref si existe (slug). */
  refCookieValue: string | null | undefined;
  /** sha256(ip+salt) — para lookup ref_touches. */
  ipHash: string | null;
  /** UA del request (truncado a 500). */
  userAgent: string | null;
  /** Email del que se está registrando (para self-referral check). */
  signupEmail: string;
}

export interface AttributionResult {
  resellerId: string | null;
  source: "cookie" | "ref_touches" | "none";
  selfReferralFlagged: boolean;
}

/**
 * Devuelve el reseller_id (o null = venta directa Ordy).
 * Side-effect: inserta audit_log si detecta self-referral.
 */
export async function resolveResellerAttribution(
  input: AttributionInput,
): Promise<AttributionResult> {
  // 1. Cookie first-touch
  if (input.refCookieValue) {
    const r = await resolveBySlug(input.refCookieValue);
    if (r) {
      const selfRef = await checkAndLogSelfReferral(r.id, r.userId, input.signupEmail);
      return { resellerId: r.id, source: "cookie", selfReferralFlagged: selfRef };
    }
  }

  // 2. ref_touches fallback (solo si tenemos ipHash + UA)
  if (input.ipHash) {
    const anonId = computeAnonId(input.ipHash, input.userAgent);
    const [touch] = await db
      .select({ resellerId: refTouches.resellerId })
      .from(refTouches)
      .where(
        and(
          eq(refTouches.anonId, anonId),
          gte(
            refTouches.firstSeenAt,
            sql`now() - interval '${sql.raw(String(ATTRIBUTION_HOLD_DAYS))} days'`,
          ),
        ),
      )
      .orderBy(desc(refTouches.firstSeenAt))
      .limit(1);
    if (touch) {
      const [r] = await db
        .select({ id: resellers.id, userId: resellers.userId })
        .from(resellers)
        .where(and(eq(resellers.id, touch.resellerId), eq(resellers.status, "active")))
        .limit(1);
      if (r) {
        const selfRef = await checkAndLogSelfReferral(r.id, r.userId, input.signupEmail);
        return { resellerId: r.id, source: "ref_touches", selfReferralFlagged: selfRef };
      }
    }
  }

  return { resellerId: null, source: "none", selfReferralFlagged: false };
}

async function resolveBySlug(slug: string): Promise<{ id: string; userId: string } | null> {
  // Valida formato defensivamente (el middleware ya lo hizo, pero nunca está de más).
  if (!/^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])?$/.test(slug)) return null;
  const [r] = await db
    .select({ id: resellers.id, userId: resellers.userId })
    .from(resellers)
    .where(and(eq(resellers.slug, slug), eq(resellers.status, "active")))
    .limit(1);
  return r ?? null;
}

async function checkAndLogSelfReferral(
  resellerId: string,
  resellerUserId: string,
  signupEmail: string,
): Promise<boolean> {
  const [owner] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, resellerUserId))
    .limit(1);
  if (!owner) return false;
  const normSignup = signupEmail.trim().toLowerCase();
  const normOwner = owner.email.trim().toLowerCase();
  if (normSignup === normOwner) {
    await db.insert(auditLog).values({
      action: "reseller.attribution.self_referral_flagged",
      entity: "reseller",
      entityId: resellerId,
      metadata: { signup_email_domain: normSignup.split("@")[1] ?? null },
    });
    return true;
  }
  return false;
}
