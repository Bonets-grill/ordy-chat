// GET /api/reports/shifts/export?limit=100
// CSV con el histórico de turnos cerrados (hasta 200).
// Cada fila agrega order_count y paid_cents del turno + cuadre de caja.
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { centsToAmount, csvEscape, csvFilename, csvJoin } from "@/lib/csv";
import { db } from "@/lib/db";
import { orders, shifts } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauth" }, { status: 401 });
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "no tenant" }, { status: 404 });

  const url = new URL(req.url);
  const limitRaw = Number(url.searchParams.get("limit") ?? "100");
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 200) : 100;

  // Mismo shape que /api/reports/shifts pero incluimos expected/diff calculados
  // para que el contable vea el cuadre directo.
  const rows = await db
    .select({
      id: shifts.id,
      openedAt: shifts.openedAt,
      closedAt: shifts.closedAt,
      openedBy: shifts.openedBy,
      closedBy: shifts.closedBy,
      openingCashCents: shifts.openingCashCents,
      countedCashCents: shifts.countedCashCents,
      notes: shifts.notes,
      orderCount: sql<number>`(
        SELECT count(*)::int FROM ${orders} o
        WHERE o.shift_id = ${shifts.id} AND o.is_test = false
      )`,
      paidCents: sql<number>`(
        SELECT coalesce(sum(o.total_cents), 0)::int FROM ${orders} o
        WHERE o.shift_id = ${shifts.id} AND o.is_test = false AND o.paid_at IS NOT NULL
      )`,
    })
    .from(shifts)
    .where(and(eq(shifts.tenantId, bundle.tenant.id), isNotNull(shifts.closedAt)))
    .orderBy(desc(shifts.openedAt))
    .limit(limit);

  const header = [
    "shift_id",
    "opened_at",
    "closed_at",
    "opened_by",
    "closed_by",
    "opening_cash_cents",
    "counted_cash_cents",
    "paid_cents",
    "expected_cash_cents",
    "diff_cents",
    "order_count",
    "notes",
  ] as const;

  const body = rows.map((r) => {
    const expected = r.openingCashCents + r.paidCents;
    const diff = r.countedCashCents === null ? null : r.countedCashCents - expected;
    return [
      csvEscape(r.id),
      r.openedAt.toISOString(),
      r.closedAt ? r.closedAt.toISOString() : "",
      csvEscape(r.openedBy ?? ""),
      csvEscape(r.closedBy ?? ""),
      centsToAmount(r.openingCashCents),
      centsToAmount(r.countedCashCents),
      centsToAmount(r.paidCents),
      centsToAmount(expected),
      centsToAmount(diff),
      String(r.orderCount ?? 0),
      csvEscape(r.notes ?? ""),
    ];
  });

  const csv = csvJoin(header, body);
  const filename = csvFilename({
    base: "turnos",
    tenantSlug: bundle.tenant.slug,
  });

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
