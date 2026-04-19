// web/app/api/landing/improve-prompt/route.ts
// Endpoint público de la landing. Recibe la descripción cruda que el usuario
// escribe en el hero y devuelve una versión "brief" pulida, lista para alimentar
// nuestro sistema de generación de agentes.
//
// Anti-abuso:
//   - Rate limit 5 req / 10 min / IP (Upstash).
//   - Cap input 500 chars.
//   - Usa Haiku 4.5 (barato, rápido).

import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { resolveAnthropicApiKey } from "@/lib/anthropic-key";
import { limitByIpImprovePrompt } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 30;

const SYSTEM_PROMPT = `Eres el "cerebro" de Ordy Chat, la IA especializada para restaurantes, bares y cafeterías en España. Construimos SOLO agentes de WhatsApp para hostelería — NO clínicas, NO inmobiliarias, NO academias, NO abogados, NO tiendas online.

Tarea: el usuario escribió una descripción breve y cruda de su local. Conviértela en un brief optimizado para que nuestro sistema genere un agente hostelero excelente.

Un buen brief hostelero incluye:
- Tipo de local (restaurante, bar de tapas, cafetería, pizzería, marisquería, asador, hamburguesería, cervecería, heladería, panadería...).
- Ubicación (ciudad/barrio si el usuario la dio).
- Qué hace el cliente típico: reservar mesa, pedir carta, pedidos para recoger/entrega, consultar horarios, alergias.
- 2-3 casos de uso concretos (ej: "reservas noche con marea", "maridajes de vino", "pedidos gluten-free").
- Tono implícito (cercano familiar, cálido, casual, fine-dining...).

Reglas:
- Escribe en ESPAÑOL, primera persona, como si fuera el dueño del local.
- Máximo 3 oraciones. Sin relleno.
- NO inventes datos que el usuario no proporcionó (ni ciudad, ni nombre, ni especialidades concretas).
- Si el usuario describe un negocio que NO es hostelería (clínica, tienda, inmobiliaria, etc.): devuelve LITERALMENTE "Ordy Chat está especializado en restaurantes, bares y cafeterías. ¿Tu negocio es de hostelería? Si es así, cuéntame más."
- Si el input ya es bueno, mejóralo ligeramente sin alargarlo.
- Si el input es demasiado vago, añade una pregunta específica: "¿[dato que falta]?".
- Devuelve SOLO el brief mejorado. Sin preámbulo, sin comillas, sin markdown.`;

function getIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || "anon";
  return req.headers.get("x-real-ip") || "anon";
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { text?: unknown };
    const text = typeof body.text === "string" ? body.text.trim() : "";

    if (!text) {
      return NextResponse.json({ error: "missing_text" }, { status: 400 });
    }
    if (text.length < 5) {
      return NextResponse.json({ error: "too_short" }, { status: 400 });
    }
    if (text.length > 500) {
      return NextResponse.json({ error: "too_long" }, { status: 400 });
    }

    const ip = getIp(req);
    const rl = await limitByIpImprovePrompt(ip);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "rate_limited", reset: rl.reset },
        { status: 429 },
      );
    }

    const apiKey = await resolveAnthropicApiKey();
    const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 25_000 });

    const res = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: text }],
    });

    const improved = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    if (!improved) {
      return NextResponse.json({ error: "empty_response" }, { status: 502 });
    }

    return NextResponse.json({ improved });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "unknown_error";
    return NextResponse.json(
      { error: "improve_failed", detail: msg },
      { status: 500 },
    );
  }
}
