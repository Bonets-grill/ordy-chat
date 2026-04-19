// web/app/api/fiscal/verifactu/retry/[receiptId]/route.ts
// POST — reintenta un recibo en error/rechazado llamando a processReceiptForOrder
// de nuevo. Ownership-checked. Idempotente: el orquestador detecta si ya se procesó.

import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { receipts } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";
import { processReceiptForOrder } from "@/lib/verifactu";

export const runtime = "nodejs";
export const maxDuration = 60;

const RETRYABLE_STATES = new Set(["error", "error_permanent", "rejected"]);

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ receiptId: string }> },
) {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const { receiptId } = await ctx.params;

  const [current] = await db
    .select()
    .from(receipts)
    .where(and(eq(receipts.id, receiptId), eq(receipts.tenantId, bundle.tenant.id)))
    .limit(1);

  if (!current) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (!RETRYABLE_STATES.has(current.verifactuStatus)) {
    return NextResponse.json(
      {
        error: "not_retryable",
        status: current.verifactuStatus,
        message: "Solo se pueden reintentar recibos en error, error_permanent o rejected.",
      },
      { status: 409 },
    );
  }

  // Reset al state que processReceiptForOrder procesará: marcarlo skipped
  // NO — el orquestador recibe orderId y decide. Mejor llamar directo.
  const result = await processReceiptForOrder(current.orderId);

  return NextResponse.json({
    ok: true,
    previousStatus: current.verifactuStatus,
    newStatus: result.status,
    error: result.error,
  });
}
