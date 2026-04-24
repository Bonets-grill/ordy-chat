// web/app/api/tenant/tables/layout/route.ts
//
// GET → lista las mesas del tenant con coordenadas del plano + estado en vivo
// derivado de `table_sessions` (la sesión NO cerrada por mesa, si la hay).
//
// Status que devuelve por mesa:
//   - 'free'    → sin sesión viva (closed_at IS NOT NULL o no hay sesión).
//   - 'active'  → sesión status IN ('pending','active').
//   - 'billing' → sesión status='billing' (cliente pidió la cuenta).
//   - 'paid'    → sesión status='paid' (cobrada, pendiente cierre/limpieza).
//
// Multi-tenant. Usa LEFT JOIN para que mesas sin sesión también vuelvan.

import { NextResponse } from "next/server";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { restaurantTables, tableSessions } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TableStatus = "free" | "active" | "billing" | "paid";

function mapStatus(s: string | null): TableStatus {
  if (!s) return "free";
  if (s === "billing") return "billing";
  if (s === "paid") return "paid";
  if (s === "pending" || s === "active") return "active";
  // closed o desconocido → libre
  return "free";
}

export async function GET() {
  const bundle = await requireTenant();
  if (!bundle) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // LEFT JOIN: tablas + sesión NO cerrada (closed_at IS NULL) por (tenant, number).
  // El partial unique de table_sessions garantiza máximo 1 fila viva por mesa.
  const rows = await db
    .select({
      id: restaurantTables.id,
      number: restaurantTables.number,
      posX: restaurantTables.posX,
      posY: restaurantTables.posY,
      shape: restaurantTables.shape,
      seats: restaurantTables.seats,
      rotation: restaurantTables.rotation,
      area: restaurantTables.area,
      zone: restaurantTables.zone,
      width: restaurantTables.width,
      height: restaurantTables.height,
      active: restaurantTables.active,
      sessionId: tableSessions.id,
      sessionStatus: tableSessions.status,
      sessionTotalCents: tableSessions.totalCents,
    })
    .from(restaurantTables)
    .leftJoin(
      tableSessions,
      and(
        eq(tableSessions.tenantId, restaurantTables.tenantId),
        eq(tableSessions.tableNumber, restaurantTables.number),
        isNull(tableSessions.closedAt),
        // Excluye sesiones marcadas como playground.
        eq(tableSessions.isTest, sql`false`),
      ),
    )
    .where(eq(restaurantTables.tenantId, bundle.tenant.id))
    .orderBy(asc(restaurantTables.sortOrder), asc(restaurantTables.number));

  const tables = rows.map((r) => ({
    id: r.id,
    tableNumber: r.number,
    posX: r.posX,
    posY: r.posY,
    shape: r.shape as "square" | "round" | "rect",
    seats: r.seats,
    rotation: r.rotation,
    // `area` (mig 043) es la fuente nueva. `zone` (mig 035) es legacy: si area es
    // null la usamos como fallback para que tenants antiguos no pierdan info.
    area: r.area ?? r.zone ?? null,
    width: r.width,
    height: r.height,
    active: r.active,
    status: mapStatus(r.sessionStatus),
    sessionId: r.sessionId ?? undefined,
    totalCents: r.sessionTotalCents ?? undefined,
  }));

  return NextResponse.json({ tables });
}
