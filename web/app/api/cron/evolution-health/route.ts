// web/app/api/cron/evolution-health/route.ts — Vercel Cron cada 10 min.
// Disparador del healthcheck de instancias Evolution. Passthrough al runtime.

import { passthroughToRuntime, validateCronAuth } from "@/lib/cron";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const unauthorized = validateCronAuth(req);
  if (unauthorized) return unauthorized;
  return passthroughToRuntime("/internal/health/evolution-all", "GET");
}
