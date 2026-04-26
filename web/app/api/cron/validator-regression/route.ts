// web/app/api/cron/validator-regression/route.ts
// Vercel Cron diario (06:00 UTC). Lanza el validator (LLM-as-judge) sobre
// TODOS los tenants active/trialing para detectar regresiones de calidad
// del agente sin que el dueño tenga que invocarlo manualmente.
//
// Mario reportaba: "el validator existe pero solo se dispara desde admin
// manualmente — si el system_prompt drift, no nos enteramos hasta que un
// cliente se queja". Este cron cierra ese loop.

import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { tenants } from "@/lib/db/schema";
import { validateCronAuth } from "@/lib/cron";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  // CN-011 fix 2026-04-26: usar helper timing-safe en lugar de !==
  const unauthorized = validateCronAuth(req);
  if (unauthorized) return unauthorized;

  const runtimeUrl = (process.env.RUNTIME_URL ?? "").replace(/\/$/, "");
  const secret = process.env.RUNTIME_INTERNAL_SECRET ?? "";
  if (!runtimeUrl || !secret) {
    return NextResponse.json({ error: "runtime_not_configured" }, { status: 500 });
  }

  // Lista de tenants vivos. Excluimos trial expirados, cancelados, pausados.
  const targets = await db
    .select({ id: tenants.id, slug: tenants.slug })
    .from(tenants)
    .where(
      and(
        inArray(tenants.subscriptionStatus, ["active", "trialing"]),
      ),
    )
    .limit(50); // sane cap

  // Fire-and-forget en serie con stagger 1s (evita stampede en runtime).
  // El validator runner usa Semaphore(5) interno por seeds, así que enviar
  // 1 tenant cada segundo deja al runtime margen para responder a webhooks
  // reales sin saturar Anthropic.
  let dispatched = 0;
  let failed = 0;
  for (const t of targets) {
    try {
      const res = await fetch(`${runtimeUrl}/internal/validator/run-seeds`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": secret,
        },
        body: JSON.stringify({ tenant_id: t.id, triggered_by: "cron_regression" }),
        signal: AbortSignal.timeout(8_000),
      });
      if (res.ok || res.status === 202) dispatched++;
      else failed++;
    } catch {
      failed++;
    }
    // stagger 1s.
    await new Promise((r) => setTimeout(r, 1000));
  }

  return NextResponse.json({
    ok: true,
    candidates: targets.length,
    dispatched,
    failed,
  });
}
