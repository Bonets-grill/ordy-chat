import type { NextConfig } from "next";

// Security headers globales. CSP se publica en modo Report-Only por defecto
// (audit 2026-04-25): Stripe.js, Vercel inline runtime y Auth.js requieren
// 'unsafe-inline' temporal que vamos a ir reduciendo con nonces antes de
// promover a enforce. Para activar enforce: setear NEXT_PUBLIC_CSP_ENFORCE=1
// en el env de Vercel. El header Report-Only no rompe la web aunque la lista
// no sea perfecta — solo loguea violaciones (visible en DevTools console).
const CSP_DIRECTIVES = [
  "default-src 'self'",
  // Stripe Checkout/Elements + Vercel runtime + Auth.js callbacks
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://*.vercel-insights.com https://va.vercel-scripts.com",
  // Tailwind inline styles + shadcn portals
  "style-src 'self' 'unsafe-inline'",
  // Imágenes propias + WhatsApp media URLs + Stripe + tenant logos
  "img-src 'self' data: blob: https:",
  // Auth.js, Stripe, Vercel telemetry, runtime Railway, Whapi/Meta/Twilio webhooks
  "connect-src 'self' https://api.stripe.com https://*.vercel-insights.com https://va.vercel-scripts.com https://ordy-chat-runtime-production.up.railway.app https://api.anthropic.com",
  // Stripe Elements iframe + iframes de tenant menu (chat embed)
  "frame-src 'self' https://js.stripe.com https://hooks.stripe.com",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const CSP_HEADER_KEY = process.env.NEXT_PUBLIC_CSP_ENFORCE === "1"
  ? "Content-Security-Policy"
  : "Content-Security-Policy-Report-Only";

const SECURITY_HEADERS = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  { key: CSP_HEADER_KEY, value: CSP_DIRECTIVES },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: false,
  },
  serverExternalPackages: ["@neondatabase/serverless"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
      {
        // SW v1 cache: nunca cachear el propio SW (para permitir updates rápidos).
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        // iOS Universal Links: Apple exige Content-Type: application/json
        // y el archivo SIN extensión bajo /.well-known/.
        source: "/.well-known/apple-app-site-association",
        headers: [
          { key: "Content-Type", value: "application/json" },
          { key: "Cache-Control", value: "public, max-age=3600" },
        ],
      },
      {
        // Android App Links: Google exige content-type: application/json.
        source: "/.well-known/assetlinks.json",
        headers: [
          { key: "Content-Type", value: "application/json" },
          { key: "Cache-Control", value: "public, max-age=3600" },
        ],
      },
    ];
  },
};

export default nextConfig;
