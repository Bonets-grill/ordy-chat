// web/app/api/public/menu-voice-transcribe/[slug]/route.ts
//
// Endpoint PÚBLICO (sin auth) para transcribir audios del widget público de
// la carta /m/<slug>. Proxea al runtime `/internal/public-menu/transcribe`,
// que reutiliza el mismo Whisper (app.audio.transcribir_audio) usado para
// audios WhatsApp.
//
// Seguridad:
//   - Rate limit por IP (limitByIpWebchat) para bloquear abuse.
//   - Validación del slug antes de reenviar al runtime.
//   - Límite de tamaño 25 MB (coincide con el límite Whisper).
//   - is_test no aplica aquí: no persistimos nada, solo transcribimos.
//
// Request: multipart/form-data
//   - audio: Blob (webm/mp4/ogg/m4a/wav)
//   - lang: str (opcional, ISO-639-1)

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { tenants } from "@/lib/db/schema";
import { limitByIpWebchat } from "@/lib/rate-limit";

export const runtime = "nodejs";

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB — Whisper límite

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

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

  const [tenant] = await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1);
  if (!tenant) {
    return NextResponse.json({ error: "tenant_not_found" }, { status: 404 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid_form" }, { status: 400 });
  }
  const audio = form.get("audio");
  const lang = typeof form.get("lang") === "string" ? (form.get("lang") as string) : "";

  if (!audio || typeof audio === "string") {
    return NextResponse.json({ error: "audio_required" }, { status: 400 });
  }
  const file = audio as File;
  if (file.size === 0) {
    return NextResponse.json({ error: "audio_empty" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "audio_too_large" }, { status: 413 });
  }

  const runtimeUrl = (process.env.RUNTIME_URL ?? "").replace(/\/$/, "");
  const secret = process.env.RUNTIME_INTERNAL_SECRET ?? "";
  if (!runtimeUrl || !secret) {
    return NextResponse.json({ error: "runtime_not_configured" }, { status: 503 });
  }

  const upstream = new FormData();
  // Reenviamos el blob tal cual con el content-type original.
  upstream.append("audio", file, file.name || "voice.webm");
  upstream.append("tenant_slug", slug);
  if (lang) upstream.append("lang", lang);

  try {
    const r = await fetch(`${runtimeUrl}/internal/public-menu/transcribe`, {
      method: "POST",
      headers: {
        // No ponemos Content-Type — fetch lo ajusta con el boundary automático.
        "x-internal-secret": secret,
      },
      body: upstream,
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      const status = r.status === 503 ? 503 : 502;
      return NextResponse.json(
        { error: "runtime_error", status: r.status, detail: text.slice(0, 300) },
        { status },
      );
    }
    const data = (await r.json()) as { text?: string; lang?: string };
    return NextResponse.json({ text: data.text ?? "", lang: data.lang ?? "" });
  } catch (err) {
    return NextResponse.json(
      { error: "fetch_failed", detail: String(err).slice(0, 200) },
      { status: 502 },
    );
  }
}
