// web/app/api/scrape/route.ts — Endpoint autenticado que ejecuta el scraper.

import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { scrapeBusinessUrl } from "@/lib/scraper";

export const runtime = "nodejs";
export const maxDuration = 60;

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

  try {
    const result = await scrapeBusinessUrl(parsed.data.url);
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
    const msg = (e as Error).message ?? "error";
    return NextResponse.json({ ok: false, error: msg }, { status: 422 });
  }
}
