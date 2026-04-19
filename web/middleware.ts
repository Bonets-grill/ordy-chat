import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authConfig } from "@/lib/auth.config";
import { limitByIp, rateLimitConfigured } from "@/lib/rate-limit";
import { hasAttributionConsent } from "@/lib/reseller/consent";

// Edge-safe auth: sólo lee el JWT cookie. NO importa `@/lib/auth` (que arrastra
// DrizzleAdapter + Credentials + argon2 → incompatible edge).
const { auth } = NextAuth(authConfig);

// Regex sincronizado con CHECK resellers_slug_format de la migración 012.
const RESELLER_SLUG_REGEX = /^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])?$/;
const ORDY_REF_COOKIE_MAX_AGE = 60 * 60 * 24 * Number(process.env.ORDY_REF_COOKIE_DAYS ?? 90);

// Prefijos de /api que están EXENTOS de rate limit:
//   - Stripe valida firma (stripe-signature) en su handler
//   - Runtime Python manda webhooks internos con secreto compartido
//   - Auth.js tiene su propia protección
const RATE_LIMIT_EXEMPT_API = [
  "/api/stripe/webhook",
  "/api/webhook/",
  "/api/auth/",
];

async function applyRateLimit(req: NextRequest): Promise<NextResponse | null> {
  if (!rateLimitConfigured()) return null;
  const { pathname } = req.nextUrl;
  if (!pathname.startsWith("/api/")) return null;
  if (RATE_LIMIT_EXEMPT_API.some((p) => pathname.startsWith(p))) return null;

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";

  const r = await limitByIp(ip);
  if (!r.ok) {
    const retryAfter = Math.max(1, Math.ceil((r.reset - Date.now()) / 1000));
    return NextResponse.json(
      { error: "rate_limited", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }
  return null;
}

export default auth(async (req) => {
  // 1. Rate limit (solo /api/*, solo si Upstash configurado)
  const rlResponse = await applyRateLimit(req as unknown as NextRequest);
  if (rlResponse) return rlResponse;

  // 2. Auth-protected pages
  const { pathname } = req.nextUrl;
  const isAuthed = !!req.auth;
  const isAdmin = req.auth?.user?.role === "super_admin";

  if (pathname.startsWith("/admin")) {
    if (!isAuthed) return NextResponse.redirect(new URL("/signin?from=/admin", req.url));
    if (!isAdmin) {
      // Resellers van a su panel, tenants al dashboard.
      const dest = req.auth?.user?.role === "reseller" ? "/reseller" : "/dashboard";
      return NextResponse.redirect(new URL(dest, req.url));
    }
  }

  if (pathname.startsWith("/reseller")) {
    if (!isAuthed) return NextResponse.redirect(new URL("/signin?from=/reseller", req.url));
    if (req.auth?.user?.role !== "reseller") {
      const dest = isAdmin ? "/admin/resellers" : "/dashboard";
      return NextResponse.redirect(new URL(dest, req.url));
    }
  }

  const protectedApp =
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/onboarding") ||
    pathname.startsWith("/conversations") ||
    pathname.startsWith("/agent") ||
    pathname.startsWith("/billing");

  if (protectedApp && !isAuthed) {
    return NextResponse.redirect(new URL(`/signin?from=${pathname}`, req.url));
  }

  // 3. Reseller attribution capture (first-touch, consent-gated).
  // Nunca sobrescribe cookie existente. Skip admin/reseller/api para no
  // fijar sesiones mediante ?ref= en URLs sensibles.
  const ref = req.nextUrl.searchParams.get("ref");
  const skipRef =
    pathname.startsWith("/admin") ||
    pathname.startsWith("/reseller") ||
    pathname.startsWith("/api");
  if (
    ref &&
    !skipRef &&
    RESELLER_SLUG_REGEX.test(ref) &&
    !req.cookies.get("ordy_ref") &&
    hasAttributionConsent(req.headers.get("cookie"))
  ) {
    const res = NextResponse.next();
    res.cookies.set("ordy_ref", ref, {
      maxAge: ORDY_REF_COOKIE_MAX_AGE,
      sameSite: "lax",
      path: "/",
      httpOnly: false, // JS cliente lo lee para el beacon /api/ref/touch
      secure: process.env.NODE_ENV === "production",
    });
    return res;
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    // Landing (ref capture) + páginas protegidas + /api/* (rate-limited, menos exentos arriba).
    "/",
    "/dashboard/:path*",
    "/onboarding/:path*",
    "/conversations/:path*",
    "/agent/:path*",
    "/billing/:path*",
    "/admin/:path*",
    "/reseller/:path*",
    "/api/:path*",
  ],
};
