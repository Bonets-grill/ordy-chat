// web/app/api/cron/onboarding-reap/route.ts — Vercel Cron cada minuto.
// Watchdog: marca como failed los onboarding_jobs cuyo deadline expiró.

import { passthroughToRuntime, validateCronAuth } from "@/lib/cron";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const unauthorized = validateCronAuth(req);
  if (unauthorized) return unauthorized;
  return passthroughToRuntime("/internal/jobs/reap", "GET");
}
