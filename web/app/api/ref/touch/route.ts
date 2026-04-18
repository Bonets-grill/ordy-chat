// web/app/api/ref/touch/route.ts
// POST /api/ref/touch — graba un ref_touch server-side (ITP dual-write vs cookie).
//
// Defensas (en orden):
// 1. Sec-Fetch-Dest: empty (rechaza image/iframe embeds cross-site)
// 2. UA filter (bots conocidos → 204 silencioso, no cuenta clicks)
// 3. Zod body validation
// 4. Rate limit: 50/h por slug (cookie stuffing dirigido) + IP global existente
// 5. Resolver reseller: debe existir + status='active' o 204 silencioso
// 6. INSERT ref_touches con ON CONFLICT DO NOTHING (first-touch garantizado)
// 7. Audit log

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLog, refTouches, resellers } from "@/lib/db/schema";
import { limitByIp, limitByResellerSlug } from "@/lib/rate-limit";
import { computeAnonId, hashIp } from "@/lib/reseller/anon-id";

const SLUG_REGEX = /^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])?$/;

const BODY_SCHEMA = z.object({
  ref: z.string().regex(SLUG_REGEX).max(40),
  utm_source: z.string().max(100).nullable().optional(),
  utm_medium: z.string().max(100).nullable().optional(),
  utm_campaign: z.string().max(100).nullable().optional(),
  utm_term: z.string().max(100).nullable().optional(),
  utm_content: z.string().max(200).nullable().optional(),
  referer: z.string().max(500).nullable().optional(),
});

const BOT_UA_RE =
  /googlebot|bingbot|slurp|yandex|ahrefs|semrush|mj12bot|facebookexternalhit|applebot|duckduckbot|petalbot|baiduspider/i;

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // 1. Sec-Fetch-Dest guard — beacons legítimos mandan "empty"
  const secFetchDest = req.headers.get("sec-fetch-dest");
  if (secFetchDest !== null && secFetchDest !== "empty") {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  // 2. UA bot filter
  const ua = req.headers.get("user-agent") ?? "";
  if (BOT_UA_RE.test(ua)) return new NextResponse(null, { status: 204 });

  // 3. Zod
  let body: z.infer<typeof BODY_SCHEMA>;
  try {
    body = BODY_SCHEMA.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  // 4. Rate limits (IP global ya lo aplica el middleware, pero duplicamos por slug)
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  const ipRate = await limitByIp(ip);
  if (!ipRate.ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const slugRate = await limitByResellerSlug(body.ref);
  if (!slugRate.ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  // 5. Resolver reseller activo
  const [reseller] = await db
    .select({ id: resellers.id })
    .from(resellers)
    .where(and(eq(resellers.slug, body.ref), eq(resellers.status, "active")))
    .limit(1);
  if (!reseller) {
    // No filtramos 404 para evitar enumeración de slugs — 204 silent.
    return new NextResponse(null, { status: 204 });
  }

  // 6. INSERT ref_touches (first-touch garantizado por UNIQUE(anon_id, reseller_id))
  const ipH = hashIp(ip);
  const anonId = computeAnonId(ipH, ua);
  await db
    .insert(refTouches)
    .values({
      resellerId: reseller.id,
      anonId,
      ipHash: ipH,
      userAgent: ua.slice(0, 500) || null,
      utmSource: body.utm_source ?? null,
      utmMedium: body.utm_medium ?? null,
      utmCampaign: body.utm_campaign ?? null,
      utmTerm: body.utm_term ?? null,
      utmContent: body.utm_content ?? null,
      referer: body.referer?.slice(0, 500) ?? null,
    })
    .onConflictDoNothing();

  // 7. Audit log (metadata solo con prefix de anon_id, no IP)
  await db.insert(auditLog).values({
    action: "reseller.attribution.touch",
    entity: "reseller",
    entityId: reseller.id,
    metadata: {
      anon_id_prefix: anonId.slice(0, 8),
      has_utm: Boolean(body.utm_source || body.utm_medium || body.utm_campaign),
    },
  });

  return new NextResponse(null, { status: 204 });
}
