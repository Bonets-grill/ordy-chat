// web/app/api/cron/onboarding-purge/route.ts — Vercel Cron diario 03:00 UTC.
// RGPD retention: purga result_json de onboarding_jobs > 30 días.

import { passthroughToRuntime, validateCronAuth } from "@/lib/cron";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const unauthorized = validateCronAuth(req);
  if (unauthorized) return unauthorized;
  return passthroughToRuntime("/internal/jobs/purge-results", "GET");
}
