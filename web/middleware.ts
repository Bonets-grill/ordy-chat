import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { limitByIp, rateLimitConfigured } from "@/lib/rate-limit";

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
    if (!isAdmin) return NextResponse.redirect(new URL("/dashboard", req.url));
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

  return NextResponse.next();
});

export const config = {
  matcher: [
    // Páginas protegidas + /api/* (rate-limited, menos exentos arriba).
    "/dashboard/:path*",
    "/onboarding/:path*",
    "/conversations/:path*",
    "/agent/:path*",
    "/billing/:path*",
    "/admin/:path*",
    "/api/:path*",
  ],
};
