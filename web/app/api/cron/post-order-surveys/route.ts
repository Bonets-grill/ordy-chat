// web/app/api/cron/post-order-surveys/route.ts
// Vercel Cron cada 15 min. Proxy hacia runtime /internal/surveys/dispatch que
// envía la encuesta NPS post-pedido (mig 057) a clientes 24h después de pagar
// dentro de la ventana 14:00-20:00 hora local del tenant. Idempotency por
// post_order_surveys.status (pending → sent/skipped_*). Protegido con CRON_SECRET.

import { NextResponse } from "next/server";
import { validateCronAuth } from "@/lib/cron";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const unauthorized = validateCronAuth(req);
  if (unauthorized) return unauthorized;

  const runtimeUrl = (process.env.RUNTIME_URL ?? "").replace(/\/$/, "");
  const secret = process.env.RUNTIME_INTERNAL_SECRET ?? "";
  if (!runtimeUrl || !secret) {
    return NextResponse.json({ error: "runtime_not_configured" }, { status: 500 });
  }

  try {
    const res = await fetch(`${runtimeUrl}/internal/surveys/dispatch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": secret,
      },
      signal: AbortSignal.timeout(50_000),
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
