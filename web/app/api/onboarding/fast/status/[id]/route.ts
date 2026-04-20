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

/** Construye un error legible "origin=razón, origin=razón" para cuando el
 *  merger produjo canonicos vacío. La UI puede parsear la primera palabra
 *  (`all_sources_blocked` / `sources_sin_datos` / `merger_empty`) como
 *  subcódigo y mostrar un mensaje específico — ejemplo:
 *    "all_sources_blocked: google=captcha_blocked: recaptcha, tripadvisor=captcha_blocked: datadome, website=ssrf_blocked: private_ip"
 */
function buildEmptySourcesError(rawSources: RawSource[], parseEmpty: string[]): string {
  if (rawSources.length === 0) {
    return "merger_empty: sin fuentes en el job";
  }
  const parts: string[] = [];
  for (const src of rawSources) {
    if (!src.ok) {
      parts.push(`${src.origin}=${src.error ?? "unknown"}`);
    } else if (parseEmpty.includes(src.origin)) {
      parts.push(`${src.origin}=parse_empty`);
    }
  }
  if (parts.length === 0) {
    // Todas las sources están ok y tuvieron data parseada, pero el LLM
    // (o el fallback) no logró emitir nada válido — caso raro.
    return "merger_empty: fuentes con datos pero merger sin resultado";
  }
  const allBlocked = rawSources.every((s) => !s.ok);
  const prefix = allBlocked ? "all_sources_blocked" : "sources_sin_datos";
  return `${prefix}: ${parts.join(", ")}`.slice(0, 280);
}

async function runMergerForJob(jobId: string, currentResult: ScrapeResultJson | null): Promise<void> {
  const rawSources = currentResult?.sources ?? [];
  try {
    // Parse cada HTML con su parser correspondiente. Trackeamos qué origin
    // vino vacío tras parsear — necesario para el error estructurado cuando
    // canonicos termina vacío (caso Bonets Grill: parsers devolvían {} y el
    // frontend solo veía canonicos={} sin razón concreta).
    const parsed: SourceData[] = [];
    const parseEmpty: string[] = [];
    for (const src of rawSources) {
      if (!src.ok || !src.html) continue;
      let data: SourceData["data"] | null = null;
      if (src.origin === "google") data = parseGoogleBusiness(src.html);
      else if (src.origin === "tripadvisor") data = parseTripadvisor(src.html);
      else if (src.origin === "website") data = parseWebsite(src.html);
      if (!data) continue;
      if (Object.keys(data).length === 0) {
        parseEmpty.push(src.origin);
      } else {
        parsed.push({ origin: src.origin, data });
      }
    }

    const mergerOut = await mergeFuentes({ sources: parsed });

    // Si canonicos quedó vacío construimos un error descriptivo por origin
    // para que el frontend pueda mostrar la causa concreta (captcha,
    // bot-block, SSRF, parse vacío) en lugar del genérico
    // "No pudimos leer tus URLs". Mantenemos status='ready' para no romper
    // el contrato actual — el frontend discrimina por `error != null`.
    const canonicosEmpty = Object.keys(mergerOut.canonicos).length === 0;
    const errorMessage = canonicosEmpty
      ? buildEmptySourcesError(rawSources, parseEmpty)
      : null;

    await db
      .update(onboardingJobs)
      .set({
        status: "ready",
        resultJson: {
          sources: rawSources,
          canonicos: mergerOut.canonicos,
          conflictos: mergerOut.conflictos,
        },
        error: errorMessage,
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

