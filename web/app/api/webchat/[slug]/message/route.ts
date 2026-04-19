// web/app/api/webchat/[slug]/message/route.ts
// POST { sessionId, text, history? } → { reply }
// Webchat público del tenant. El cliente mantiene el historial en localStorage
// y lo envía en cada turno (stateless en servidor — v1). El endpoint llama a
// Claude con el system_prompt del agente del tenant.
//
// Anti-abuso:
// - Rate limit 30 req/min/IP (Upstash).
// - Cap text 2000 chars, history 20 turnos.
// - Requiere tenant existente y con onboardingCompleted + !paused.

import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { resolveAnthropicApiKey } from "@/lib/anthropic-key";
import { db } from "@/lib/db";
import { agentConfigs, tenants } from "@/lib/db/schema";
import { limitByIpWebchat } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 30;

type HistoryTurn = { role: "user" | "assistant"; content: string };

function getIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || "anon";
  return req.headers.get("x-real-ip") || "anon";
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await ctx.params;

    const body = (await req.json().catch(() => ({}))) as {
      sessionId?: unknown;
      text?: unknown;
      history?: unknown;
    };

    const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const rawHistory = Array.isArray(body.history) ? body.history : [];

    if (!sessionId || sessionId.length < 8 || sessionId.length > 80) {
      return NextResponse.json({ error: "invalid_session" }, { status: 400 });
    }
    if (!text) {
      return NextResponse.json({ error: "missing_text" }, { status: 400 });
    }
    if (text.length > 2000) {
      return NextResponse.json({ error: "too_long" }, { status: 400 });
    }

    const ip = getIp(req);
    const rl = await limitByIpWebchat(ip);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "rate_limited", reset: rl.reset },
        { status: 429 },
      );
    }

    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.slug, slug))
      .limit(1);
    if (!tenant) {
      return NextResponse.json({ error: "tenant_not_found" }, { status: 404 });
    }

    const [config] = await db
      .select()
      .from(agentConfigs)
      .where(eq(agentConfigs.tenantId, tenant.id))
      .limit(1);
    if (!config || !config.onboardingCompleted) {
      return NextResponse.json(
        { error: "tenant_not_configured" },
        { status: 503 },
      );
    }
    if (config.paused) {
      return NextResponse.json(
        { reply: config.fallbackMessage || "Estamos fuera en este momento. Vuelve pronto." },
      );
    }

    // Historial limitado + sanitizado (solo roles válidos, content string).
    const history: HistoryTurn[] = rawHistory
      .slice(-20)
      .map((h): HistoryTurn | null => {
        if (h === null || typeof h !== "object") return null;
        const o = h as { role?: unknown; content?: unknown };
        if (o.role !== "user" && o.role !== "assistant") return null;
        if (typeof o.content !== "string" || !o.content.trim()) return null;
        return { role: o.role, content: o.content.slice(0, 2000) };
      })
      .filter((h): h is HistoryTurn => h !== null);

    // Claude espera que messages alterne user/assistant y termine en user.
    // Nuestro nuevo text entra al final como user.
    const claudeMessages = [
      ...history,
      { role: "user" as const, content: text },
    ];

    const apiKey = await resolveAnthropicApiKey();
    const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 25_000 });

    const res = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 800,
      system: config.systemPrompt,
      messages: claudeMessages,
    });

    const reply = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    if (!reply) {
      return NextResponse.json(
        { reply: config.errorMessage || "No he podido procesarlo. Reintenta, por favor." },
      );
    }

    return NextResponse.json({ reply });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json(
      { error: "webchat_failed", detail: msg },
      { status: 500 },
    );
  }
}
