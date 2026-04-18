// web/app/api/onboarding/fast/status/[id]/route.ts — GET: estado del job + disparo del merger.
//
// Flujo:
//   1. Auth → 401.
//   2. Lee onboarding_jobs WHERE id AND user_id. Si no match → 404 (oculta existencia).
//   3. Si status='sources_ready': UPDATE atómico → lanza merger LLM → UPDATE status='ready'.
//      Race-safe: el UPDATE a 'ready' con WHERE status='sources_ready' garantiza que
//      solo un request corre el merger; los otros devuelven el estado actualizado.
//   4. Responde {status, result_json, error}.

import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { onboardingJobs } from "@/lib/db/schema";
import { mergeFuentes } from "@/lib/onboarding-fast/merger";
import type { SourceData } from "@/lib/onboarding-fast/merger-deterministic";
import { parseGoogleBusiness } from "@/lib/scraper/google-business";
import { parseTripadvisor } from "@/lib/scraper/tripadvisor";
import { parseWebsite } from "@/lib/scraper/website";

export const dynamic = "force-dynamic";

type RawSource = {
  origin: string;
  url: string;
  ok: boolean;
  html?: string;
  final_url?: string;
  error?: string;
};

type ScrapeResultJson = {
  sources?: RawSource[];
  canonicos?: Record<string, unknown>;
  conflictos?: Array<{ campo: string; valores: Array<{ origen: string; valor: unknown }> }>;
};

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const userId = session.user.id;
  const { id } = await ctx.params;

  const [job] = await db
    .select()
    .from(onboardingJobs)
    .where(and(eq(onboardingJobs.id, id), eq(onboardingJobs.userId, userId)))
    .limit(1);

  if (!job) {
    // 404 en vez de 403 para no filtrar existencia de jobs de otros usuarios.
    return NextResponse.json({ error: "Job no encontrado" }, { status: 404 });
  }

  // Si el runtime dejó el job en sources_ready, disparamos el merger ahora.
  // UPDATE atómico a 'confirming' actúa como lock (solo un request lo ejecuta).
  if (job.status === "sources_ready") {
    const claimed = await db
      .update(onboardingJobs)
      .set({ status: "confirming", updatedAt: new Date() })
      .where(and(eq(onboardingJobs.id, id), eq(onboardingJobs.status, "sources_ready")))
      .returning({ id: onboardingJobs.id });

    if (claimed.length > 0) {
      await runMergerForJob(id, job.resultJson as ScrapeResultJson | null);
    }
    // Re-leemos el job (el merger actualizó status).
    const [updated] = await db
      .select()
      .from(onboardingJobs)
      .where(eq(onboardingJobs.id, id))
      .limit(1);
    return NextResponse.json({
      status: updated?.status ?? job.status,
      result_json: updated?.resultJson ?? null,
      error: updated?.error ?? null,
    });
  }

  return NextResponse.json({
    status: job.status,
    result_json: job.resultJson ?? null,
    error: job.error ?? null,
  });
}

async function runMergerForJob(jobId: string, currentResult: ScrapeResultJson | null): Promise<void> {
  const rawSources = currentResult?.sources ?? [];
  try {
    // Parse cada HTML con su parser correspondiente.
    const parsed: SourceData[] = [];
    for (const src of rawSources) {
      if (!src.ok || !src.html) continue;
      if (src.origin === "google") {
        parsed.push({ origin: "google", data: parseGoogleBusiness(src.html) });
      } else if (src.origin === "tripadvisor") {
        parsed.push({ origin: "tripadvisor", data: parseTripadvisor(src.html) });
      } else if (src.origin === "website") {
        parsed.push({ origin: "website", data: parseWebsite(src.html) });
      }
    }

    const mergerOut = await mergeFuentes({ sources: parsed });

    await db
      .update(onboardingJobs)
      .set({
        status: "ready",
        resultJson: {
          sources: rawSources,
          canonicos: mergerOut.canonicos,
          conflictos: mergerOut.conflictos,
        },
        updatedAt: new Date(),
      })
      .where(eq(onboardingJobs.id, jobId));
  } catch (err) {
    console.error("[onboarding-fast] merger error:", err);
    await db
      .update(onboardingJobs)
      .set({
        status: "failed",
        error: `merger_error: ${err instanceof Error ? err.message : String(err)}`.slice(0, 280),
        updatedAt: new Date(),
      })
      .where(eq(onboardingJobs.id, jobId));
  }
}

