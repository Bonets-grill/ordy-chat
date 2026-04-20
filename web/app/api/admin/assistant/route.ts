// web/app/api/admin/assistant/route.ts
// Asistente super-admin con Claude Opus 4.7. Streaming SSE. Auth requireSuperAdmin.
// Rate-limit 20 msgs/hora por usuario. Cada turno deja rastro en audit_log.
//
// El asistente tiene contexto estructurado del sistema (lista de tenants, último
// estado de cada agente, flags, runs recientes del validador) pero NO ejecuta
// mutaciones — solo aconseja. Si Mario quiere mover algo, lo hace él en la UI o
// le pide a Claude SQL/pasos que copia y ejecuta aparte. V1 es advisory-only
// para mantenerlo seguro.

import Anthropic from "@anthropic-ai/sdk";
import { desc, eq, gte, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSuperAdmin, AdminAuthError } from "@/lib/admin/auth";
import { db } from "@/lib/db";
import {
  agentConfigs,
  auditLog,
  tenants,
  validatorRuns,
} from "@/lib/db/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MODEL_ID = "claude-opus-4-7";
const MAX_TOKENS = 4096;
const RATE_LIMIT_PER_HOUR = 20;

const bodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(8000),
      }),
    )
    .min(1)
    .max(40),
});

async function loadSystemContext(): Promise<string> {
  // Lista de tenants con nombre, slug, estado de suscripción, agente paused.
  const tenantRows = await db
    .select({
      id: tenants.id,
      slug: tenants.slug,
      name: tenants.name,
      subscriptionStatus: tenants.subscriptionStatus,
      paused: agentConfigs.paused,
      validationMode: agentConfigs.validationMode,
      onboardingCompleted: agentConfigs.onboardingCompleted,
    })
    .from(tenants)
    .leftJoin(agentConfigs, eq(agentConfigs.tenantId, tenants.id))
    .orderBy(desc(tenants.createdAt));

  // Últimos 10 validator runs.
  const recentRuns = await db
    .select({
      id: validatorRuns.id,
      tenantId: validatorRuns.tenantId,
      nicho: validatorRuns.nicho,
      status: validatorRuns.status,
      summary: validatorRuns.summaryJson,
      createdAt: validatorRuns.createdAt,
    })
    .from(validatorRuns)
    .orderBy(desc(validatorRuns.createdAt))
    .limit(10);

  return JSON.stringify(
    {
      tenants: tenantRows,
      recent_validator_runs: recentRuns,
      generated_at: new Date().toISOString(),
    },
    null,
    2,
  );
}

const SYSTEM_PROMPT = `Eres el asistente del super admin de Ordy Chat (SaaS multi-tenant de agentes WhatsApp para restaurantes, clínicas, hoteles, servicios). Hablas con Mario, el owner de la plataforma.

## Quién eres y qué puedes hacer
- Modelo Claude Opus 4.7. Respondes en español directo, tuteo, sin floritura.
- Tienes acceso READ al estado del sistema vía el bloque <contexto_sistema> que Mario te inyecta al principio de cada turno (lista de tenants, runs del validador, flags, errores).
- NO ejecutas mutaciones en el sistema: no tocas DB, no mandas WhatsApp, no cambias flags. Eres advisory. Si Mario necesita ejecutar algo, le das:
  * SQL exacto (para correr contra Neon con psql)
  * Comando shell (curl al runtime interno, railway variables, vercel env, etc.)
  * Pasos concretos en la UI super admin
- Al final de cada recomendación destructiva añade: "Confirma antes de ejecutar." (aunque sea SQL, Mario la corre).

## Reglas duras
1. Honestidad absoluta: si no lo sabes, dilo. Si el contexto no lo tiene, pídelo. Mario odia la invención.
2. Quirúrgico: propón el cambio mínimo que resuelve el problema. Nada de refactors al paso.
3. Evidencia primero: antes de proponer un fix, pide o cita el output que demuestra el problema.
4. Cuando Mario pregunte por un tenant, cita sus datos literales (slug, estado, último run) del <contexto_sistema>.
5. Si el tenant está paused: explica por qué (probablemente validator fail post-autopatch) y propón acción.
6. Respuestas cortas salvo que Mario pida detalle. Párrafos breves, code blocks cuando aplique.
7. Nunca pegues secretos (API keys, DATABASE_URL, tokens) en respuestas. Si necesitas referirte a uno dile "la key guardada en Vercel/Railway" sin pegarla.

## Qué hacer cuando Mario dice "tenant X tiene problema"
1. Busca el tenant en <contexto_sistema> por slug o nombre.
2. Mira sus últimos validator_runs: ¿fail? ¿passed? ¿razones?
3. Mira si está paused.
4. Propón diagnóstico + fix surgical. Prioriza reproducir el síntoma antes de tocar código.

## Cuando Mario te pida modificar algo del sistema
Para cambios en código/infra, sigue el ciclo Mario exige: audit previa → diff mínimo → test → audit posterior con output literal. Si es un cambio de prompt, recuerda que los evals Promptfoo son obligatorios antes.`;

// Rate-limit en memoria (suficiente para 1 super admin; si hay más, mover a redis).
const _rateLimit = new Map<string, { count: number; resetAt: number }>();

function checkRate(userId: string): { ok: boolean; retryInSec?: number } {
  const now = Date.now();
  const hour = 60 * 60 * 1000;
  const entry = _rateLimit.get(userId);
  if (!entry || entry.resetAt < now) {
    _rateLimit.set(userId, { count: 1, resetAt: now + hour });
    return { ok: true };
  }
  if (entry.count >= RATE_LIMIT_PER_HOUR) {
    return { ok: false, retryInSec: Math.ceil((entry.resetAt - now) / 1000) };
  }
  entry.count += 1;
  return { ok: true };
}

export async function POST(req: Request) {
  let userId: string;
  try {
    const auth = await requireSuperAdmin();
    userId = auth.userId;
  } catch (e) {
    if (e instanceof AdminAuthError) {
      const status = e.code === "UNAUTHENTICATED" ? 401 : 403;
      return NextResponse.json({ error: e.code }, { status });
    }
    return NextResponse.json({ error: "auth_error" }, { status: 401 });
  }

  const rl = checkRate(userId);
  if (!rl.ok) {
    return NextResponse.json(
      {
        error: "rate_limit",
        message: `Máximo ${RATE_LIMIT_PER_HOUR} mensajes/hora.`,
        retry_after_seconds: rl.retryInSec,
      },
      { status: 429 },
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { messages } = parsed.data;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY no configurada en Vercel" },
      { status: 500 },
    );
  }

  const context = await loadSystemContext();
  const systemWithContext =
    `${SYSTEM_PROMPT}\n\n<contexto_sistema>\n${context}\n</contexto_sistema>`;

  // Audit log del turno (antes del stream por si el cliente se desconecta).
  const lastUser = messages[messages.length - 1];
  try {
    await db.insert(auditLog).values({
      userId,
      action: "super_admin_assistant_msg",
      entity: "admin_assistant",
      metadata: {
        model: MODEL_ID,
        user_message_preview: lastUser.content.slice(0, 300),
        message_count: messages.length,
      },
    });
  } catch (e) {
    console.error("[admin-assistant] audit_log insert failed:", e);
  }

  const client = new Anthropic({ apiKey });

  try {
    const stream = await client.messages.create({
      model: MODEL_ID,
      max_tokens: MAX_TOKENS,
      system: systemWithContext,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
    });

    const encoder = new TextEncoder();
    const body = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of stream) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              controller.enqueue(encoder.encode(event.delta.text));
            }
          }
          controller.close();
        } catch (err) {
          console.error("[admin-assistant] stream error:", err);
          controller.enqueue(
            encoder.encode(
              `\n\n[Error: ${err instanceof Error ? err.message : "unknown"}]`,
            ),
          );
          controller.close();
        }
      },
    });

    return new Response(body, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Model": MODEL_ID,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[admin-assistant] anthropic error:", err);
    const msg = err instanceof Error ? err.message : "anthropic_error";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
