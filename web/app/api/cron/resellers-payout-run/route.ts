// web/app/api/cron/resellers-payout-run/route.ts
// Cron día 5 del mes (08:00 UTC ≈ 09-10 Madrid): agrega commissions del mes
// anterior en drafts de reseller_payouts status='ready'.
//
// NO mueve dinero — Mario aprueba manualmente desde /admin/payouts.

import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";
import { validateCronAuth } from "@/lib/cron";
import { aggregateMonthlyPayouts } from "@/lib/payouts/aggregate";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const unauthorized = validateCronAuth(req);
  if (unauthorized) return unauthorized;

  // Periodo a cerrar = mes anterior al de ejecución. Primer día, UTC.
  const now = new Date();
  const periodMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));

  const result = await aggregateMonthlyPayouts(periodMonth);

  await db.insert(auditLog).values({
    action: "reseller.payouts.cron_run",
    entity: "cron",
    metadata: {
      period: result.periodMonth,
      resellers_processed: result.resellersProcessed,
      payouts_ready: result.payoutsReady,
      skipped_min_amount: result.skippedMinAmount,
      errors_count: result.errors.length,
    },
  });

  return NextResponse.json(result);
}
