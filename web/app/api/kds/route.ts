// web/app/api/kds/route.ts
// GET — lista órdenes activas del tenant con items filtrados por station
// (cocina | bar | all). El KDS UI hace polling cada 2s sobre este endpoint.

import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { orderItems, orders } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";

// Mig 027: pending_kitchen_review entra como nueva sección arriba en KDS (cards
// con botones aceptar/rechazar en vez de avance directo).
const ACTIVE_STATUSES = ["pending_kitchen_review", "pending", "preparing", "ready"] as const;
const VALID_STATIONS = ["all", "kitchen", "bar"] as const;
type Station = (typeof VALID_STATIONS)[number];

export async function GET(req: Request) {
  const bundle = await requireTenant();
  if (!bundle) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const stationParam = url.searchParams.get("station") || "all";
  const station: Station = VALID_STATIONS.includes(stationParam as Station)
    ? (stationParam as Station)
    : "all";

  const activeOrders = await db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.tenantId, bundle.tenant.id),
        inArray(orders.status, ACTIVE_STATUSES as unknown as string[]),
      ),
    );

  if (activeOrders.length === 0) {
    return NextResponse.json(
      { orders: [] },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const orderIds = activeOrders.map((o) => o.id);
  const allItems = await db
    .select()
    .from(orderItems)
    .where(inArray(orderItems.orderId, orderIds));

  const itemsInScope =
    station === "all" ? allItems : allItems.filter((it) => it.station === station);

  // Si se filtra por station, solo mostrar órdenes con al menos un item de esa station.
  const relevantOrderIds =
    station === "all"
      ? new Set(orderIds)
      : new Set(itemsInScope.map((it) => it.orderId));

  const result = activeOrders
    .filter((o) => relevantOrderIds.has(o.id))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((o) => ({
      id: o.id,
      tableNumber: o.tableNumber,
      customerName: o.customerName,
      customerPhone: o.customerPhone,
      status: o.status,
      orderType: o.orderType,
      pickupEtaMinutes: o.pickupEtaMinutes,
      kitchenDecision: o.kitchenDecision,
      totalCents: o.totalCents,
      currency: o.currency,
      notes: o.notes,
      createdAt: o.createdAt.toISOString(),
      items: itemsInScope
        .filter((it) => it.orderId === o.id)
        .map((it) => ({
          id: it.id,
          name: it.name,
          quantity: it.quantity,
          station: it.station,
          notes: it.notes,
        })),
    }));

  return NextResponse.json(
    { orders: result, station },
    { headers: { "Cache-Control": "no-store" } },
  );
}
