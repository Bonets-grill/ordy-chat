// web/app/api/kds/route.ts
// GET — lista órdenes activas del tenant con items filtrados por station
// (cocina | bar | all). El KDS UI hace polling cada 2s sobre este endpoint.

import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { orderItems, orders } from "@/lib/db/schema";
import { requireTenantOrKiosk } from "@/lib/kiosk-auth";

export const runtime = "nodejs";

// Mig 027: pending_kitchen_review entra como nueva sección arriba en KDS (cards
// con botones aceptar/rechazar en vez de avance directo).
const ACTIVE_STATUSES = ["pending_kitchen_review", "pending", "preparing", "ready"] as const;
const VALID_STATIONS = ["all", "kitchen", "bar"] as const;
type Station = (typeof VALID_STATIONS)[number];

export async function GET(req: Request) {
  const bundle = await requireTenantOrKiosk(req);
  if (!bundle) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const stationParam = url.searchParams.get("station") || "all";
  const station: Station = VALID_STATIONS.includes(stationParam as Station)
    ? (stationParam as Station)
    : "all";
  // Mig 029: por defecto ocultamos pedidos de playground (is_test=true). El KDS UI
  // añade includeTest=1 cuando el admin activa el toggle "🧪 Incluir pruebas".
  const includeTest = url.searchParams.get("includeTest") === "1";

  const activeOrders = await db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.tenantId, bundle.tenant.id),
        inArray(orders.status, ACTIVE_STATUSES as unknown as string[]),
        ...(includeTest ? [] : [eq(orders.isTest, false)]),
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
      isTest: o.isTest,
      // Mig 039: el KDS pinta badge "Pagado" + select preseleccionado con el
      // método actual si ya se cobró. Si paidAt es null el botón dice "Cobrar".
      paymentMethod: o.paymentMethod,
      paidAt: o.paidAt ? o.paidAt.toISOString() : null,
      // Mig 041: propina guardada (0 si no se introdujo). El KDS muestra
      // "guardada: X €" para que el camarero sepa que ya hay propina.
      tipCents: o.tipCents,
      createdAt: o.createdAt.toISOString(),
      items: itemsInScope
        .filter((it) => it.orderId === o.id)
        .map((it) => ({
          id: it.id,
          name: it.name,
          quantity: it.quantity,
          station: it.station,
          notes: it.notes,
          // Mig 042: snapshot de modifiers seleccionados. Vacío si el item
          // no tiene modifiers o si es pre-mig 042.
          modifiers: it.modifiersJson ?? [],
        })),
    }));

  return NextResponse.json(
    { orders: result, station, includeTest },
    { headers: { "Cache-Control": "no-store" } },
  );
}
