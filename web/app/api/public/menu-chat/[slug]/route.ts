// web/app/api/public/menu-chat/[slug]/route.ts
//
// Endpoint PÚBLICO (sin auth) para el mesero conversacional de la landing
// /m/<slug>. Proxea al runtime `/internal/playground/generate` reusando el
// mismo brain.py del tenant (carta dinámica, hard_rules, horario, etc).
//
// Seguridad:
//   - Rate limit por IP (limitByIpWebchat = 30 req/min por IP) para proteger
//     contra abuse de tokens Claude.
//   - No auth: cualquiera que conozca el slug público puede hablar.
//   - is_test=true en runtime: las conversaciones quedan marcadas como
//     playground (decidido en mig 029). Los pedidos reales se generan via
//     deep link WhatsApp desde el carrito, no desde el chat.

import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { restaurantTables, tenants } from "@/lib/db/schema";
import { limitByIpWebchat } from "@/lib/rate-limit";

export const runtime = "nodejs";

type Msg = { role: "user" | "assistant"; content: string };

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  // Rate limit anti-abuse (si Upstash no está configurado, es no-op).
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  const rl = await limitByIpWebchat(ip);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  // Validar slug → tenant (evita que un spammer martillee el runtime con
  // slugs aleatorios inexistentes).
  const [tenant] = await db
    .select({ id: tenants.id, slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1);
  if (!tenant) {
    return NextResponse.json({ error: "tenant_not_found" }, { status: 404 });
  }

  // Parse body
  const body = (await req.json().catch(() => null)) as {
    messages?: Msg[];
    table_number?: string | null;
    client_lang?: string | null;
  } | null;
  const rawMessages = body?.messages ?? [];
  // Mesa opcional — viene de /m/<slug>?mesa=N. Validación paranoica: máx 8
  // chars, solo alfanumérico/guion, para evitar prompt injection por URL.
  const rawTable = typeof body?.table_number === "string" ? body.table_number.trim() : "";
  let tableNumber =
    rawTable && /^[A-Za-z0-9\-]{1,8}$/.test(rawTable) ? rawTable : null;

  // Mig 048: idioma del cliente — whitelist estricta para anti-injection.
  const ALLOWED_LANGS = new Set(["es", "en", "fr", "it", "de", "pt", "ca", "eu"]);
  const rawLang =
    typeof body?.client_lang === "string"
      ? body.client_lang.trim().toLowerCase().split("-")[0]
      : "";
  const clientLang = ALLOWED_LANGS.has(rawLang) ? rawLang : null;

  // Validación soft: si el tenant tiene mesas configuradas, el number
  // DEBE existir y estar activa. Backwards-compat: tenants sin mesas
  // configuradas (restaurant_tables vacío para el tenant) aceptan
  // cualquier number, como antes del rollout del plano de mesas.
  if (tableNumber) {
    const [configured] = await db
      .select({ id: restaurantTables.id })
      .from(restaurantTables)
      .where(eq(restaurantTables.tenantId, tenant.id))
      .limit(1);
    if (configured) {
      const [match] = await db
        .select({ id: restaurantTables.id, active: restaurantTables.active })
        .from(restaurantTables)
        .where(
          and(
            eq(restaurantTables.tenantId, tenant.id),
            eq(restaurantTables.number, tableNumber),
          ),
        )
        .limit(1);
      if (!match || !match.active) {
        return NextResponse.json(
          {
            error: "table_not_found",
            detail: `La mesa "${tableNumber}" no está configurada. Avisa al camarero.`,
          },
          { status: 400 },
        );
      }
    }
  }
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    return NextResponse.json({ error: "messages_required" }, { status: 400 });
  }
  if (rawMessages.length > 40) {
    return NextResponse.json({ error: "too_many_messages" }, { status: 400 });
  }
  const lastMsg = rawMessages[rawMessages.length - 1];
  if (!lastMsg || lastMsg.role !== "user") {
    return NextResponse.json({ error: "last_must_be_user" }, { status: 400 });
  }
  const userText = String(lastMsg.content ?? "").trim();
  if (userText.length < 1 || userText.length > 2000) {
    return NextResponse.json({ error: "content_length" }, { status: 400 });
  }

  const messages: Msg[] = rawMessages.slice(-20).map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: String(m.content ?? "").slice(0, 2000),
  }));

  const runtimeUrl = (process.env.RUNTIME_URL ?? "").replace(/\/$/, "");
  const secret = process.env.RUNTIME_INTERNAL_SECRET ?? "";
  if (!runtimeUrl || !secret) {
    return NextResponse.json({ error: "runtime_not_configured" }, { status: 503 });
  }

  try {
    const r = await fetch(`${runtimeUrl}/internal/playground/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": secret,
      },
      body: JSON.stringify({
        tenant_slug: slug,
        messages,
        // Pasamos la mesa al runtime sólo si llegó y es válida. El brain
        // la inyecta como contexto del system prompt para el flujo
        // "bebidas primero + KDS con mesa" de los QR en mesa.
        ...(tableNumber ? { table_number: tableNumber, channel: "menu_web" } : {}),
        // Mig 048: idioma del cliente para que el bot responda en él.
        ...(clientLang ? { client_lang: clientLang } : {}),
      }),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return NextResponse.json(
        { error: "runtime_error", status: r.status, detail: text.slice(0, 300) },
        { status: 502 },
      );
    }
    const data = (await r.json()) as {
      response?: string;
      cards?: Array<Record<string, unknown>>;
    };
    return NextResponse.json({
      response: data.response ?? "",
      cards: data.cards ?? [],
    });
  } catch (err) {
    return NextResponse.json(
      { error: "fetch_failed", detail: String(err).slice(0, 200) },
      { status: 502 },
    );
  }
}
