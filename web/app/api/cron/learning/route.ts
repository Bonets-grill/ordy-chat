// web/app/api/cron/learning/route.ts
// Vercel Cron dispara este endpoint diario (03:00 UTC). Proxy hacia el
// runtime /internal/learning/run con {all: true}. Protegido con CRON_SECRET.

import { NextResponse } from "next/server";
import { validateCronAuth } from "@/lib/cron";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300; // 5 min para todos los tenants

export async function GET(req: Request) {
  // CN-011 fix 2026-04-26: usar helper timing-safe en lugar de !==
  const unauthorized = validateCronAuth(req);
  if (unauthorized) return unauthorized;

  const runtimeUrl = (process.env.RUNTIME_URL ?? "").replace(/\/$/, "");
  const secret = process.env.RUNTIME_INTERNAL_SECRET ?? "";
  if (!runtimeUrl || !secret) {
    return NextResponse.json({ error: "runtime_not_configured" }, { status: 500 });
  }

  try {
    const res = await fetch(`${runtimeUrl}/internal/learning/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": secret,
      },
      body: JSON.stringify({ all: true }),
      signal: AbortSignal.timeout(280_000),
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json({ status: res.status, data }, { status: res.ok ? 200 : 502 });
  } catch (e) {
    return NextResponse.json(
      { error: "runtime_unreachable", detail: e instanceof Error ? e.message : "unknown" },
      { status: 502 },
    );
  }
}
