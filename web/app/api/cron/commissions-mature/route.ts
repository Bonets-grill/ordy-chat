// web/app/api/cron/commissions-mature/route.ts
// Cron diario: flips pending→payable tras 30d hold (anti churn-farming).
//
// Condiciones para promover pending→payable:
//   - invoice_paid_at + 30d <= now()
//   - refunded_at IS NULL
//   - tenant_churned_at IS NULL OR tenant_churned_at > invoice_paid_at + 30d
//     (si el tenant churneó dentro del hold, NO se paga la comisión)

import { NextResponse, type NextRequest } from "next/server";
import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLog, resellerCommissions } from "@/lib/db/schema";
import { validateCronAuth } from "@/lib/cron";

export const dynamic = "force-dynamic";

const HOLD_DAYS = Number(process.env.COMMISSION_MATURE_DAYS ?? 30);

export async function GET(req: NextRequest) {
  const unauthorized = validateCronAuth(req);
  if (unauthorized) return unauthorized;

  const matured = await db
    .update(resellerCommissions)
    .set({ status: "payable" })
    .where(
      and(
        eq(resellerCommissions.status, "pending"),
        lte(
          resellerCommissions.invoicePaidAt,
          sql`now() - interval '${sql.raw(String(HOLD_DAYS))} days'`,
        ),
        isNull(resellerCommissions.refundedAt),
        or(
          isNull(resellerCommissions.tenantChurnedAt),
          sql`${resellerCommissions.tenantChurnedAt} > ${resellerCommissions.invoicePaidAt} + interval '${sql.raw(String(HOLD_DAYS))} days'`,
        ),
      ),
    )
    .returning({ id: resellerCommissions.id });

  if (matured.length > 0) {
    await db.insert(auditLog).values({
      action: "reseller.commissions.matured",
      entity: "reseller_commissions",
      metadata: { count: matured.length, hold_days: HOLD_DAYS },
    });
  }

  return NextResponse.json({ matured: matured.length });
}
