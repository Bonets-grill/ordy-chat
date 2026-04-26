// web/app/api/cron/daily-sales-report/route.ts — Vercel Cron 22:55 UTC.
//
// Mig 040. Una vez al día:
//   1. Para cada tenant con al menos 1 pedido pagado (is_test=false) en las
//      últimas 24h, cierra sus turnos abiertos marcando auto_closed=true
//      (counted_cash queda NULL — no hay cuadre físico automático).
//   2. Calcula el resumen del día en TZ Europe/Madrid.
//   3. Dispara sendPosReport(tenant, 'daily_summary', ...) fire-and-forget.
//
// Schedule en vercel.json: "55 22 * * *" → 22:55 UTC.
//   - En invierno (CET, UTC+1) esto es 23:55 Madrid → objetivo cumplido.
//   - En verano (CEST, UTC+2) esto es 00:55 Madrid del día siguiente.
//     Vercel Cron no soporta TZ dinámica; aceptamos el desfase estacional
//     (documentado en el PR). El resumen sigue cubriendo las últimas 24h
//     rodantes, así que el dato es correcto — solo cambia la hora del
//     envío WA.

import { sql } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { validateCronAuth } from "@/lib/cron";
import { sendPosReport } from "@/lib/pos-reports";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type TenantDailyRow = {
  tenantId: string;
  orderCount: number;
  totalCents: number;
  /** Fecha local del día que reportamos — la ventana 00:00→23:59 Madrid
   *  del día que acaba de cerrar. */
  reportDate: string;
};

type ShiftLineRow = {
  tenantId: string;
  openedAt: string;
  closedAt: string | null;
  orderCount: number;
  totalCents: number;
};

type TopItemRow = {
  tenantId: string;
  name: string;
  quantity: number;
};

type PaymentBreakdownRow = {
  tenantId: string;
  cashCents: number | null;
  cardCents: number | null;
};

function fmtHHMM(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Madrid",
    hour12: false,
  });
}

function eurosLabel(cents: number | null): string {
  if (cents == null) return "—";
  return `${(cents / 100).toFixed(2).replace(/\.00$/, "")} €`;
}

export async function GET(req: NextRequest) {
  const unauthorized = validateCronAuth(req);
  if (unauthorized) return unauthorized;

  const errors: Array<{ tenantId: string; err: string }> = [];

  // Tenants con actividad en las últimas 24h (zona: el "hoy" se define como
  // el día que acaba de terminar en Madrid). Usamos un window rodante de
  // 24h para que el cron sea resiliente a retrasos del scheduler.
  const tenantsActive = (await db.execute(sql`
    SELECT
      t.id::text AS "tenantId",
      COUNT(o.id)::int AS "orderCount",
      COALESCE(SUM(o.total_cents), 0)::int AS "totalCents",
      to_char((now() AT TIME ZONE 'Europe/Madrid')::date, 'DD/MM/YYYY') AS "reportDate"
    FROM tenants t
    JOIN orders o ON o.tenant_id = t.id
    WHERE o.is_test = false
      AND o.paid_at IS NOT NULL
      AND o.paid_at >= now() - interval '24 hours'
    GROUP BY t.id
  `)) as unknown as TenantDailyRow[];

  // 2026-04-26 (Mario decisión): el auto-close de turnos al final del día
  // se REMOVIÓ. Cierre de turno es manual (botón en /dashboard/turno) tras
  // verificar que todas las cuentas están cobradas. Este cron solo emite
  // el reporte de ventas; no toca shifts.closed_at.
  // Si un tenant olvida cerrar día tras día, el reporte sigue agregando
  // pedidos al mismo turno — eso es comportamiento esperado hasta que el
  // dueño lo cierre manualmente.

  // Para cada tenant activo: líneas por turno + top items + breakdown cash/card.
  for (const row of tenantsActive) {
    try {
      const shiftLines = (await db.execute(sql`
        SELECT
          s.tenant_id::text AS "tenantId",
          s.opened_at::text AS "openedAt",
          s.closed_at::text AS "closedAt",
          COUNT(o.id)::int AS "orderCount",
          COALESCE(SUM(o.total_cents) FILTER (WHERE o.paid_at IS NOT NULL), 0)::int AS "totalCents"
        FROM shifts s
        LEFT JOIN orders o ON o.shift_id = s.id AND o.is_test = false
        WHERE s.tenant_id = ${row.tenantId}::uuid
          AND s.opened_at >= now() - interval '24 hours'
        GROUP BY s.id
        ORDER BY s.opened_at ASC
      `)) as unknown as ShiftLineRow[];

      const topItems = (await db.execute(sql`
        SELECT
          o.tenant_id::text AS "tenantId",
          oi.name AS "name",
          SUM(oi.quantity)::int AS "quantity"
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE o.tenant_id = ${row.tenantId}::uuid
          AND o.is_test = false
          AND o.paid_at IS NOT NULL
          AND o.paid_at >= now() - interval '24 hours'
        GROUP BY o.tenant_id, oi.name
        ORDER BY SUM(oi.quantity) DESC
        LIMIT 5
      `)) as unknown as TopItemRow[];

      // Payment breakdown defensive: si payment_method no existe (mig 039
      // aún no mergeada), devolvemos null/null.
      let breakdown: PaymentBreakdownRow = { tenantId: row.tenantId, cashCents: null, cardCents: null };
      try {
        const rows = (await db.execute(sql`
          SELECT
            COALESCE(SUM(total_cents) FILTER (WHERE COALESCE(payment_method, 'cash') = 'cash'), 0)::int AS "cashCents",
            COALESCE(SUM(total_cents) FILTER (WHERE payment_method = 'card'), 0)::int AS "cardCents"
          FROM orders
          WHERE tenant_id = ${row.tenantId}::uuid
            AND is_test = false
            AND paid_at IS NOT NULL
            AND paid_at >= now() - interval '24 hours'
        `)) as unknown as Array<{ cashCents: number; cardCents: number }>;
        if (rows[0]) {
          breakdown = { tenantId: row.tenantId, cashCents: rows[0].cashCents, cardCents: rows[0].cardCents };
        }
      } catch {
        // Columna payment_method no existe → null breakdown, el mensaje degrada.
      }

      const lines = shiftLines.map((s) => {
        const label = s.closedAt
          ? `${fmtHHMM(s.openedAt)}-${fmtHHMM(s.closedAt)}`
          : `${fmtHHMM(s.openedAt)}-abierto`;
        return `🕗 ${label} · ${s.orderCount} pedidos · ${eurosLabel(s.totalCents)}`;
      });

      await sendPosReport(row.tenantId, "daily_summary", {
        date: row.reportDate,
        orderCount: row.orderCount,
        totalCents: row.totalCents,
        cashCents: breakdown.cashCents,
        cardCents: breakdown.cardCents,
        shiftLines: lines,
        topItems: topItems.map((t) => ({ name: t.name, quantity: t.quantity })),
      });
    } catch (err) {
      errors.push({
        tenantId: row.tenantId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    tenantsProcessed: tenantsActive.length,
    errors,
  });
}
