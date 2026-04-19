// web/app/api/fiscal/receipts/route.ts
// GET — lista recibos del tenant con filtros opcionales para el monitor.
// Query: ?status=accepted|rejected|error|error_permanent|all (default 'all')
//        ?limit=N (default 50, max 200)
// Agrega contadores por status para mostrar dashboard.

import { and, desc, eq, gte } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { receipts } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";

const VALID_STATUSES = [
  "all",
  "skipped",
  "submitted",
  "accepted",
  "rejected",
  "error",
  "error_permanent",
  "not_applicable",
] as const;

export async function GET(req: Request) {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const url = new URL(req.url);
  const rawStatus = url.searchParams.get("status") || "all";
  const status = (VALID_STATUSES as readonly string[]).includes(rawStatus)
    ? rawStatus
    : "all";
  const rawLimit = Number(url.searchParams.get("limit") || 50);
  const limit = Math.min(200, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 50));

  const whereClause =
    status === "all"
      ? eq(receipts.tenantId, bundle.tenant.id)
      : and(
          eq(receipts.tenantId, bundle.tenant.id),
          eq(receipts.verifactuStatus, status),
        );

  const rows = await db
    .select()
    .from(receipts)
    .where(whereClause)
    .orderBy(desc(receipts.createdAt))
    .limit(limit);

  // Contadores por status para el panel — últimas 24h + totales.
  const allRows = await db
    .select({
      status: receipts.verifactuStatus,
      createdAt: receipts.createdAt,
    })
    .from(receipts)
    .where(eq(receipts.tenantId, bundle.tenant.id));

  const last24hCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const counts = {
    accepted: 0,
    rejected: 0,
    error: 0,
    error_permanent: 0,
    skipped: 0,
    submitted: 0,
    not_applicable: 0,
    total: allRows.length,
    errors_24h: 0,
  };
  for (const r of allRows) {
    const s = r.status as keyof typeof counts;
    if (s in counts && s !== "total" && s !== "errors_24h") {
      counts[s] += 1;
    }
    if (
      (r.status === "error" || r.status === "error_permanent" || r.status === "rejected") &&
      r.createdAt >= last24hCutoff
    ) {
      counts.errors_24h += 1;
    }
  }

  return NextResponse.json(
    {
      receipts: rows.map((r) => ({
        id: r.id,
        orderId: r.orderId,
        invoiceSeries: r.invoiceSeries,
        invoiceNumber: Number(r.invoiceNumber),
        verifactuStatus: r.verifactuStatus,
        verifactuSubmittedAt: r.verifactuSubmittedAt?.toISOString() ?? null,
        verifactuHash: r.verifactuHash,
        verifactuResponse: r.verifactuResponse,
        createdAt: r.createdAt.toISOString(),
      })),
      counts,
      status,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
