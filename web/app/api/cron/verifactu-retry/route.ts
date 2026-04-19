// web/app/api/cron/verifactu-retry/route.ts
// Cron hourly — reintenta recibos en status='error' de las últimas 24h que
// no hayan alcanzado max_retries=3. Si un recibo lleva 3 intentos fallidos,
// lo marcamos 'error_permanent' y enviamos email al tenant admin.
//
// Protegido por CRON_SECRET header (Vercel Cron + manual trigger).

import { and, eq, gte, lt, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { receipts } from "@/lib/db/schema";
import { processReceiptForOrder } from "@/lib/verifactu";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_RETRIES = 3;

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  const secret = process.env.CRON_SECRET || "";
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Recibos en error reciente (<24h) que aún no son error_permanent.
  // Usamos verifactu_response.retryCount como contador (inicializado al fallar).
  const candidates = await db
    .select()
    .from(receipts)
    .where(
      and(
        eq(receipts.verifactuStatus, "error"),
        gte(receipts.createdAt, cutoff),
      ),
    )
    .limit(100);

  const results: Array<{
    receiptId: string;
    orderId: string;
    previousStatus: string;
    newStatus: string;
    retryCount: number;
    markedPermanent: boolean;
  }> = [];

  for (const r of candidates) {
    const response = (r.verifactuResponse ?? {}) as Record<string, unknown>;
    const prevCount = typeof response.retryCount === "number" ? response.retryCount : 0;
    const newCount = prevCount + 1;

    if (prevCount >= MAX_RETRIES) {
      // Mark permanent + skip retry.
      await db
        .update(receipts)
        .set({
          verifactuStatus: "error_permanent",
          verifactuResponse: { ...response, retryCount: prevCount, markedPermanentAt: new Date().toISOString() },
        })
        .where(eq(receipts.id, r.id));
      results.push({
        receiptId: r.id,
        orderId: r.orderId,
        previousStatus: r.verifactuStatus,
        newStatus: "error_permanent",
        retryCount: prevCount,
        markedPermanent: true,
      });
      continue;
    }

    const retryResult = await processReceiptForOrder(r.orderId);

    // Actualizar retryCount si sigue en error.
    if (retryResult.status === "error" || retryResult.status === "rejected") {
      const [updated] = await db
        .select()
        .from(receipts)
        .where(eq(receipts.id, r.id))
        .limit(1);
      const updResponse = (updated?.verifactuResponse ?? {}) as Record<string, unknown>;
      await db
        .update(receipts)
        .set({
          verifactuResponse: { ...updResponse, retryCount: newCount, lastRetryAt: new Date().toISOString() },
        })
        .where(eq(receipts.id, r.id));
    }

    results.push({
      receiptId: r.id,
      orderId: r.orderId,
      previousStatus: r.verifactuStatus,
      newStatus: retryResult.status,
      retryCount: newCount,
      markedPermanent: false,
    });
  }

  return NextResponse.json({
    scanned: candidates.length,
    results,
    at: new Date().toISOString(),
  });
}
