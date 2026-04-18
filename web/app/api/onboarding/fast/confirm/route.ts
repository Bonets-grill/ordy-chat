// web/app/api/onboarding/fast/confirm/route.ts — POST: crea tenant desde job listo.
//
// Flujo:
//   1. Auth → 401.
//   2. Lee job WHERE id AND user_id AND status='ready' (ownership + estado).
//   3. Si status='done' → idempotente, devolver metadata guardada.
//   4. Merge canonicos del merger + resoluciones del usuario → CanonicalBusiness final.
//   5. Zod parse (rechaza si inválido).
//   6. createTenantFromCanonical.
//   7. UPDATE status='done' con {slug, tenant_id} en metadata.
//   8. Devuelve {slug, qrUrl}.

import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getFlag } from "@/lib/admin/flags";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { onboardingJobs } from "@/lib/db/schema";
import { parseCanonical, type CanonicalBusiness } from "@/lib/onboarding-fast/canonical";
import {
  createTenantFromCanonical,
  ProvisionError,
} from "@/lib/onboarding-fast/provision";
import { hashIp } from "@/lib/reseller/anon-id";

export const dynamic = "force-dynamic";

const confirmSchema = z.object({
  job_id: z.string().uuid(),
  resoluciones: z.record(z.string(), z.unknown()).default({}),
  tone: z.enum(["professional", "friendly", "sales", "empathetic"]),
  useCases: z.array(z.string()).min(1),
  agentName: z.string().min(2),
  schedule: z.string().min(3).optional(),
  knowledgeText: z.string().optional(),
  provider: z.enum(["whapi", "meta", "twilio", "evolution"]),
  providerCredentials: z.record(z.string(), z.string()).optional().default({}),
});

type JobResultJson = {
  sources?: unknown;
  canonicos?: Record<string, unknown>;
  conflictos?: unknown;
  done_metadata?: { slug: string; tenantId: string };
};

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const userId = session.user.id;

  const parsed = confirmSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const data = parsed.data;

  const [job] = await db
    .select()
    .from(onboardingJobs)
    .where(and(eq(onboardingJobs.id, data.job_id), eq(onboardingJobs.userId, userId)))
    .limit(1);

  if (!job) {
    return NextResponse.json({ error: "Job no encontrado" }, { status: 404 });
  }

  // Idempotencia: si ya fue confirmado antes, devolver metadata.
  if (job.status === "done") {
    const meta = (job.resultJson as JobResultJson | null)?.done_metadata;
    if (meta) {
      return NextResponse.json({ slug: meta.slug, tenantId: meta.tenantId });
    }
    // done sin metadata (no debería pasar) → reintentar flujo
  } else if (job.status !== "ready") {
    return NextResponse.json(
      { error: `Job no está listo (status=${job.status})` },
      { status: 409 },
    );
  }

  const resultJson = (job.resultJson as JobResultJson | null) ?? {};
  const canonicos = resultJson.canonicos ?? {};

  // Mezclamos canonicos (del merger) con resoluciones (del usuario para conflictos).
  // Las resoluciones GANAN — son la decisión humana post-conflict.
  const merged = { ...canonicos, ...data.resoluciones };

  let canonical: CanonicalBusiness;
  try {
    canonical = parseCanonical(merged);
  } catch (err) {
    return NextResponse.json(
      {
        error: "CanonicalBusiness final inválido tras resoluciones",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 400 },
    );
  }

  // Reseller attribution context (F1).
  const refCookie = req.headers.get("cookie")?.match(/(?:^|;\s*)ordy_ref=([^;]+)/)?.[1] ?? null;
  const ipAddr =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    null;
  const attributionContext = {
    refCookieValue: refCookie,
    ipHash: ipAddr ? hashIp(ipAddr) : null,
    userAgent: req.headers.get("user-agent")?.slice(0, 500) ?? null,
    signupEmail: session.user.email ?? "",
  };

  try {
    const result = await createTenantFromCanonical({
      userId,
      canonical,
      tone: data.tone,
      useCases: data.useCases,
      provider: data.provider,
      providerCredentials: data.providerCredentials,
      knowledgeText: data.knowledgeText,
      agentName: data.agentName,
      schedule: data.schedule,
      attributionContext,
    });

    await db
      .update(onboardingJobs)
      .set({
        status: "done",
        resultJson: {
          ...resultJson,
          done_metadata: { slug: result.slug, tenantId: result.tenantId },
        },
        updatedAt: new Date(),
      })
      .where(eq(onboardingJobs.id, data.job_id));

    // Trigger validator del tenant recién creado (Sprint 2 validador-core).
    // Fire-and-forget: NO bloquea el QR al cliente. Si validator falla o
    // runtime está down, watchdog no aplica aquí (el validator es no-crítico
    // para el onboarding). La flag validation_mode_default='skip' por
    // default deja el validador inactivo hasta que admin lo active.
    try {
      const validationMode = await getFlag<"auto" | "manual" | "skip">("validation_mode_default");
      if (validationMode !== "skip") {
        const runtimeUrl = (process.env.RUNTIME_URL ?? "").replace(/\/$/, "");
        const secret = process.env.RUNTIME_INTERNAL_SECRET ?? "";
        if (runtimeUrl && secret) {
          fetch(`${runtimeUrl}/internal/validator/run-seeds`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-internal-secret": secret },
            body: JSON.stringify({
              tenant_id: result.tenantId,
              triggered_by: "onboarding_auto",
            }),
            signal: AbortSignal.timeout(1500),
          }).catch((e) => {
            console.error("[onboarding-fast/confirm] validator trigger failed:", e);
          });
        } else {
          console.warn("[onboarding-fast/confirm] RUNTIME_URL/RUNTIME_INTERNAL_SECRET ausentes, validator skip");
        }
      }
    } catch (e) {
      // No bloquear la respuesta del confirm por fallo del flag/trigger.
      console.error("[onboarding-fast/confirm] validator flag check failed:", e);
    }

    return NextResponse.json({
      slug: result.slug,
      tenantId: result.tenantId,
      qrUrl: result.qrUrl,
    });
  } catch (err) {
    if (err instanceof ProvisionError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus });
    }
    console.error("[onboarding-fast/confirm] unexpected:", err);
    return NextResponse.json(
      { error: "Error inesperado al crear el tenant" },
      { status: 500 },
    );
  }
}
