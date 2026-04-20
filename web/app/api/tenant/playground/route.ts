// web/app/api/tenant/playground/route.ts
// Proxy desde el tenant dashboard al runtime /internal/playground/generate.
// El tenant web app NO tiene el system_prompt ni el brain — lo tiene el runtime.

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenant } from "@/lib/tenant";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(4000),
      }),
    )
    .min(1)
    .max(40),
});

export async function POST(req: Request) {
  const bundle = await requireTenant();
  if (!bundle) {
    return NextResponse.json({ error: "no_tenant" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const runtimeUrl = (process.env.RUNTIME_URL ?? "").replace(/\/$/, "");
  const secret = process.env.RUNTIME_INTERNAL_SECRET ?? "";
  if (!runtimeUrl || !secret) {
    return NextResponse.json(
      { error: "runtime_not_configured" },
      { status: 500 },
    );
  }

  try {
    const res = await fetch(`${runtimeUrl}/internal/playground/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": secret,
      },
      body: JSON.stringify({
        tenant_slug: bundle.tenant.slug,
        messages: parsed.data.messages,
      }),
      signal: AbortSignal.timeout(45_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `runtime_${res.status}`, detail: body.slice(0, 400) },
        { status: 502 },
      );
    }

    const data = (await res.json()) as {
      response: string;
      tokens_in?: number;
      tokens_out?: number;
    };
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      {
        error: "runtime_unreachable",
        detail: e instanceof Error ? e.message : "unknown",
      },
      { status: 502 },
    );
  }
}
