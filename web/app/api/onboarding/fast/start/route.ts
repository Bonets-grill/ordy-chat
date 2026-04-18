// web/app/api/onboarding/fast/start/route.ts — POST: inicia scrape de onboarding fast.
//
// Flujo:
//   1. Auth (cookies de Auth.js).
//   2. Rate limit 5/hora/user (anti-abuso).
//   3. Valida body Zod (urls + consent_accepted obligatorio).
//   4. INSERT onboarding_jobs(status='pending', consent_accepted_at, consent_ip).
//   5. POST al runtime /onboarding/scrape (fire-and-forget, x-internal-secret).
//   6. Responde {job_id}.

import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditLog, onboardingJobs } from "@/lib/db/schema";
import { limitByUserOnboarding } from "@/lib/rate-limit";

const schema = z.object({
  urls: z
    .object({
      website: z.string().url().optional(),
      google: z.string().url().optional(),
      tripadvisor: z.string().url().optional(),
    })
    .refine((u) => u.website || u.google || u.tripadvisor, {
      message: "Al menos una URL requerida",
    }),
  consent_accepted: z.literal(true, {
    message: "Debes aceptar el consentimiento para scrapear las URLs.",
  }),
});

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const userId = session.user.id;

  // Rate limit (no-op si Upstash no configurado).
  const rl = await limitByUserOnboarding(userId);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Demasiados onboardings en la última hora. Reintenta más tarde." },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    // Si falla por consent_accepted, logearlo a audit_log.
    const consentMissing = !body?.consent_accepted;
    if (consentMissing) {
      try {
        await db.insert(auditLog).values({
          userId,
          action: "onboarding_consent_missing",
          entity: "onboarding_fast",
          metadata: { urls: body?.urls ?? null },
        });
      } catch {
        // no-op
      }
    }
    return NextResponse.json(
      { error: "Datos inválidos", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const data = parsed.data;

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    null;

  const [job] = await db
    .insert(onboardingJobs)
    .values({
      userId,
      urlsJson: data.urls,
      status: "pending",
      consentAcceptedAt: new Date(),
      consentIp: ip,
    })
    .returning({ id: onboardingJobs.id });

  // Fire-and-forget al runtime — no esperamos, el worker corre en background.
  const runtimeUrl = (process.env.RUNTIME_URL ?? "").replace(/\/$/, "");
  const internalSecret = process.env.RUNTIME_INTERNAL_SECRET ?? "";
  if (runtimeUrl && internalSecret) {
    // Aprovechamos timingSafeEqualStr en los callers que VALIDAN el secret.
    // Aquí solo lo mandamos.
    fetch(`${runtimeUrl}/onboarding/scrape`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": internalSecret,
      },
      body: JSON.stringify({ job_id: job.id, urls: data.urls }),
    }).catch((err) => {
      console.error("[onboarding-fast] runtime scrape trigger fail:", err);
    });
  } else {
    console.warn("[onboarding-fast] RUNTIME_URL/RUNTIME_INTERNAL_SECRET ausentes");
  }

  return NextResponse.json({ job_id: job.id });
}

// Exportado para tests — no uso en runtime.
export const _internals = { timingSafeEqualStr };
