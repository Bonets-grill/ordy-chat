// web/lib/cron.ts — Helpers para Vercel Cron → passthrough al runtime.
//
// Vercel Cron dispara con header `Authorization: Bearer $CRON_SECRET`.
// Validamos con timingSafeEqual y hacemos passthrough al runtime con
// x-internal-secret.

import crypto from "node:crypto";
import { NextResponse } from "next/server";

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** Valida el Bearer de Vercel Cron. Devuelve NextResponse con 401/503 si falla, o null si OK. */
export function validateCronAuth(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET ?? "";
  if (!secret) {
    // Sin CRON_SECRET configurado: rechazar por seguridad (no exponer endpoints internos).
    return NextResponse.json({ error: "CRON_SECRET no configurado" }, { status: 503 });
  }
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!timingSafeEqualStr(header, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

/** Passthrough genérico a un endpoint interno del runtime. */
export async function passthroughToRuntime(
  pathAndQuery: string,
  method: "GET" | "POST" = "GET",
): Promise<NextResponse> {
  const runtimeUrl = (process.env.RUNTIME_URL ?? "").replace(/\/$/, "");
  const secret = process.env.RUNTIME_INTERNAL_SECRET ?? "";
  if (!runtimeUrl || !secret) {
    return NextResponse.json(
      { error: "RUNTIME_URL/RUNTIME_INTERNAL_SECRET ausentes" },
      { status: 503 },
    );
  }
  try {
    const r = await fetch(`${runtimeUrl}${pathAndQuery}`, {
      method,
      headers: { "x-internal-secret": secret },
      cache: "no-store",
    });
    const body = await r.json().catch(() => ({ raw: "<not json>" }));
    return NextResponse.json(body, { status: r.status });
  } catch (err) {
    return NextResponse.json(
      { error: "runtime_unreachable", detail: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
