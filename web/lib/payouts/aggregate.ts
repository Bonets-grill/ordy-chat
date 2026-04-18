// web/lib/payouts/aggregate.ts
// Agregación mensual de commissions → drafts de reseller_payouts.
//
// Steps (cron día 5 del mes M, agrega commissions del mes M-1):
//   1. Para cada reseller activo con commissions 'payable' sin payout_id en M-1:
//      a. BEGIN tx (emulada en HTTP driver).
//      b. INSERT reseller_payouts status='draft' con source_total_cents.
//      c. UPDATE commissions SET payout_id = X, status='paid' WHERE matched.
//      d. Verifica SUM(returning) == source_total_cents.
//   2. Para cada draft: apply TaxStrategy → update status='ready'.
//   3. HALT. Mario aprueba manualmente desde /admin/payouts.

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  resellerCommissions,
  resellerPayouts,
  resellers,
} from "@/lib/db/schema";
import type { Reseller } from "@/lib/db/schema";
import { applyFxPreview, ecbPreviewRate } from "./fx";
import { resolveTaxStrategy } from "./registry";

const MIN_PAYOUT_CENTS = Number(process.env.MIN_PAYOUT_CENTS ?? 1000);
const HIGH_VALUE_THRESHOLD = Number(process.env.HIGH_VALUE_PAYOUT_CENTS ?? 500000);

export interface AggregationResult {
  periodMonth: string; // YYYY-MM-01
  resellersProcessed: number;
  payoutsDraftCreated: number;
  payoutsReady: number;
  skippedMinAmount: number;
  errors: Array<{ resellerId: string; error: string }>;
}

/**
 * periodMonth: DATE del primer día del mes a cerrar (normalmente M-1 el día 5 de M).
 */
export async function aggregateMonthlyPayouts(periodMonth: Date): Promise<AggregationResult> {
  const result: AggregationResult = {
    periodMonth: periodMonth.toISOString().slice(0, 10),
    resellersProcessed: 0,
    payoutsDraftCreated: 0,
    payoutsReady: 0,
    skippedMinAmount: 0,
    errors: [],
  };

  // Query: resellers activos con payable commissions en el mes. Usamos el
  // API tipado de drizzle (no execute raw) para evitar issues con shape de
  // respuesta del driver HTTP de Neon.
  const rows = await db
    .select({
      resellerId: resellerCommissions.resellerId,
      totalCents: sql<number>`coalesce(sum(${resellerCommissions.commissionAmountCents}), 0)::int`,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(resellerCommissions)
    .innerJoin(resellers, eq(resellers.id, resellerCommissions.resellerId))
    .where(
      and(
        eq(resellerCommissions.status, "payable"),
        isNull(resellerCommissions.payoutId),
        eq(resellerCommissions.periodMonth, periodMonth),
        eq(resellers.status, "active"),
      ),
    )
    .groupBy(resellerCommissions.resellerId)
    .having(sql`coalesce(sum(${resellerCommissions.commissionAmountCents}), 0) > 0`);

  for (const row of rows) {
    const resellerId = row.resellerId;
    const totalCents = Number(row.totalCents);

    result.resellersProcessed++;

    try {
      const [reseller] = await db
        .select()
        .from(resellers)
        .where(eq(resellers.id, resellerId))
        .limit(1);
      if (!reseller) throw new Error("reseller_not_found");

      // Debt carry-over actual
      const debtCents = reseller.commissionDebtCents ?? 0;
      const effectiveAmount = Math.max(0, totalCents - debtCents);

      if (effectiveAmount < MIN_PAYOUT_CENTS) {
        result.skippedMinAmount++;
        continue;
      }

      await createDraftPayout(reseller, totalCents, debtCents, periodMonth);
      result.payoutsDraftCreated++;
      result.payoutsReady++;
    } catch (err) {
      result.errors.push({
        resellerId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

async function createDraftPayout(
  reseller: Reseller,
  sourceCents: number,
  debtCents: number,
  periodMonth: Date,
) {
  const strategy = resolveTaxStrategy(reseller);
  const breakdown = strategy.calculate(reseller, sourceCents, debtCents);

  // FX preview (no-block si falla: fx_rate queda NULL).
  let fxRate: number | null = null;
  let payoutPreviewCents: number | null = null;
  try {
    fxRate = await ecbPreviewRate(reseller.payoutCurrency);
    payoutPreviewCents = applyFxPreview(breakdown.transfer_cents, fxRate);
  } catch (err) {
    console.warn(
      `[payouts] ECB preview failed for ${reseller.payoutCurrency}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Transacción manual emulada (HTTP driver de Neon no soporta BEGIN real).
  // 1. INSERT draft payout
  const [payout] = await db
    .insert(resellerPayouts)
    .values({
      resellerId: reseller.id,
      periodMonth,
      sourceCurrency: "EUR",
      sourceTotalCents: sourceCents,
      payoutCurrency: reseller.payoutCurrency,
      fxRate: fxRate !== null ? String(fxRate) : null,
      fxSource: fxRate !== null ? "ecb_daily_preview" : null,
      payoutTotalCents: payoutPreviewCents,
      taxBreakdown: breakdown as unknown as Record<string, unknown>,
      status: "draft",
      requiresHighValueApproval: sourceCents >= HIGH_VALUE_THRESHOLD,
    })
    .returning();

  // 2. Claim commissions → payout_id, status='paid'
  const claimed = await db
    .update(resellerCommissions)
    .set({ payoutId: payout.id, status: "paid" })
    .where(
      and(
        eq(resellerCommissions.resellerId, reseller.id),
        eq(resellerCommissions.periodMonth, periodMonth),
        eq(resellerCommissions.status, "payable"),
        isNull(resellerCommissions.payoutId),
      ),
    )
    .returning({ amount: resellerCommissions.commissionAmountCents });

  const claimedSum = claimed.reduce((a, b) => a + b.amount, 0);
  if (claimedSum !== sourceCents) {
    // Mismatch entre agregado y claim: marca payout como 'failed' con nota,
    // revierte las commissions (best effort — HTTP no tiene rollback nativo).
    console.error(
      `[payouts] sum mismatch for reseller ${reseller.id}: expected=${sourceCents} claimed=${claimedSum}`,
    );
    await db
      .update(resellerCommissions)
      .set({ payoutId: null, status: "payable" })
      .where(eq(resellerCommissions.payoutId, payout.id));
    await db
      .update(resellerPayouts)
      .set({ status: "failed", failureMessage: `sum_mismatch:${sourceCents}/${claimedSum}` })
      .where(eq(resellerPayouts.id, payout.id));
    throw new Error(`sum_mismatch`);
  }

  // 3. Descuenta debt consumido
  if (breakdown.debt_clawback_cents > 0) {
    await db
      .update(resellers)
      .set({
        commissionDebtCents: sql`GREATEST(0, ${resellers.commissionDebtCents} - ${breakdown.debt_clawback_cents})`,
      })
      .where(eq(resellers.id, reseller.id));
  }

  // 4. Flip status → 'ready' (invoice generation stub por ahora)
  await db
    .update(resellerPayouts)
    .set({ status: "ready" })
    .where(eq(resellerPayouts.id, payout.id));
}
