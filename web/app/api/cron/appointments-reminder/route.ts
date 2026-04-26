// web/app/api/cron/appointments-reminder/route.ts
// Vercel Cron cada 15 min. Proxy hacia runtime /internal/appointments/remind
// que envía WA proactivo a clientes con reserva en T-2h. Idempotency por
// reminder_sent_at en DB (mig 056). Protegido con CRON_SECRET.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const expected = process.env.CRON_SECRET ?? "";
  const provided = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const runtimeUrl = (process.env.RUNTIME_URL ?? "").replace(/\/$/, "");
  const secret = process.env.RUNTIME_INTERNAL_SECRET ?? "";
  if (!runtimeUrl || !secret) {
    return NextResponse.json({ error: "runtime_not_configured" }, { status: 500 });
  }

  try {
    const res = await fetch(`${runtimeUrl}/internal/appointments/remind`, {
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
