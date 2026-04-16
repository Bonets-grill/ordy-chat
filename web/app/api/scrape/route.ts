// web/app/api/scrape/route.ts — Endpoint autenticado que ejecuta el scraper.

import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { scrapeBusinessUrl } from "@/lib/scraper";

export const runtime = "nodejs";
// Playwright via runtime proxy puede tardar 60-120s. Requiere Vercel Pro (180s).
export const maxDuration = 180;

const schema = z.object({
  url: z.string().min(4).max(300),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_input" }, { status: 400 });
  }

  const url = parsed.data.url;
  console.log(`[scrape] start url=${url}`);
  const t0 = Date.now();

  try {
    const result = await scrapeBusinessUrl(url);
    console.log(`[scrape] ok url=${url} pages=${result.pages} spa=${result.spaPagesRendered} ms=${result.durationMs}`);
    return NextResponse.json({
      ok: true,
      rootUrl: result.rootUrl,
      pages: result.pages,
      visitedUrls: result.visitedUrls,
      extracted: result.extracted,
      text: result.text,
      durationMs: result.durationMs,
    });
  } catch (e) {
    const err = e as Error;
    const elapsedMs = Date.now() - t0;
    const msg = err.message || err.name || "error";
    console.error(`[scrape] fail url=${url} ms=${elapsedMs} err=${msg}\n${err.stack ?? ""}`);
    return NextResponse.json(
      { ok: false, error: msg, elapsedMs },
      { status: 422 },
    );
  }
}
