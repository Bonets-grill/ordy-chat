// web/app/api/tenant/sidebar-counts/route.ts
//
// Counts en vivo para los badges del sidebar tenant. Polling cada 30s desde
// el shell. Una sola query agregada para minimizar round-trips a Neon.

import { NextResponse } from "next/server";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders, restaurantTables, tableSessions } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KDS_PENDING_STATUSES = ["pending_kitchen_review", "pending", "preparing"];
const OPEN_STATUSES = [...KDS_PENDING_STATUSES, "ready", "served"];

export async function GET() {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const tenantId = bundle.tenant.id;

  // Multi-query con Promise.all (neon-http no soporta tx pero acepta paralelo).
  const [pendingKds, openTables, todayOrders, openSessions] = await Promise.all([
    // KDS pending — pedidos esperando cocina (excluye is_test).
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(orders)
      .where(
        and(
          eq(orders.tenantId, tenantId),
          eq(orders.isTest, false),
          inArray(orders.status, KDS_PENDING_STATUSES),
        ),
      ),
    // Mesas ocupadas (con sesión abierta).
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(tableSessions)
      .where(
        and(
          eq(tableSessions.tenantId, tenantId),
          ne(tableSessions.status, "closed"),
          ne(tableSessions.status, "paid"),
        ),
      ),
    // Pedidos creados hoy (incluye paid + open, excluye is_test).
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(orders)
      .where(
        and(
          eq(orders.tenantId, tenantId),
          eq(orders.isTest, false),
          sql`${orders.createdAt} >= date_trunc('day', now() at time zone 'Atlantic/Canary')`,
        ),
      ),
    // Sesiones abiertas (con orden activa) — para "Comandero" badge si hay actividad.
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(orders)
      .where(
        and(
          eq(orders.tenantId, tenantId),
          eq(orders.isTest, false),
          eq(orders.orderType, "dine_in"),
          inArray(orders.status, OPEN_STATUSES),
        ),
      ),
    // restaurantTables activas (count, no badge — solo para sanity en futuro).
  ]);

  const _tablesActive = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(restaurantTables)
    .where(and(eq(restaurantTables.tenantId, tenantId), eq(restaurantTables.active, true)));

  return NextResponse.json(
    {
      kdsPending: pendingKds[0]?.count ?? 0,
      tablesOccupied: openTables[0]?.count ?? 0,
      todayOrders: todayOrders[0]?.count ?? 0,
      comanderoOpen: openSessions[0]?.count ?? 0,
      tablesTotal: _tablesActive[0]?.count ?? 0,
    },
    {
      headers: {
        // No cachear — son counts en vivo. Polling cliente cada 30s.
        "cache-control": "no-store, max-age=0",
      },
    },
  );
}
