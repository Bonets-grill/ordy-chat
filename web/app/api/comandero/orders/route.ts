// web/app/api/comandero/orders/route.ts
//
// POST — el comandero (mesero humano logueado) envía un pedido dine_in. Reusa
// createOrder() del runtime web (idéntica lógica que /api/orders pero con auth
// de session en vez de RUNTIME_INTERNAL_SECRET).
//
// Auditoría: cada orden lleva metadata.created_by_waiter_id = session.user.id.
// Las órdenes entran al KDS automáticamente (status="pending_kitchen_review").

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { menuItems, restaurantTables } from "@/lib/db/schema";
import { createOrder } from "@/lib/orders";
import { limitByUserId } from "@/lib/rate-limit";
import { getComanderoActor } from "@/lib/employees/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BODY = z.object({
  tableNumber: z.string().min(1).max(8).regex(/^[A-Za-z0-9\-]+$/),
  notes: z.string().max(500).optional(),
  items: z
    .array(
      z.object({
        menuItemId: z.string().uuid(),
        quantity: z.number().int().min(1).max(50),
        notes: z.string().max(200).optional(),
        modifiers: z
          .array(
            z.object({
              groupId: z.string().min(1),
              modifierId: z.string().min(1),
              name: z.string().min(1),
              priceDeltaCents: z.number().int().min(0).max(100_000),
            }),
          )
          .max(20)
          .optional(),
      }),
    )
    .min(1)
    .max(50),
});

export async function POST(req: NextRequest) {
  const actor = await getComanderoActor();
  if (!actor) return NextResponse.json({ error: "unauth" }, { status: 401 });

  // Rate-limit por actor (employee.id si keypad, user.id si owner directo).
  const rateKey = actor.kind === "employee" ? actor.employeeId : actor.userId;
  const rate = await limitByUserId(rateKey, "comandero_create_order", 120, "1 h");
  if (!rate.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const parsed = BODY.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_input", issues: parsed.error.flatten() }, { status: 400 });
  }

  // Validar mesa contra restaurant_tables del tenant.
  const [tableRow] = await db
    .select({ id: restaurantTables.id, active: restaurantTables.active })
    .from(restaurantTables)
    .where(
      and(
        eq(restaurantTables.tenantId, actor.tenantId),
        eq(restaurantTables.number, parsed.data.tableNumber),
      ),
    )
    .limit(1);
  if (!tableRow || !tableRow.active) {
    return NextResponse.json({ error: "table_not_found" }, { status: 404 });
  }

  // Resolver name + price + tax desde menu_items para cada línea (no
  // confiamos en que el cliente nos los pase — anti-tampering).
  const ids = parsed.data.items.map((i) => i.menuItemId);
  const dbItems = await db
    .select({
      id: menuItems.id,
      name: menuItems.name,
      priceCents: menuItems.priceCents,
      available: menuItems.available,
    })
    .from(menuItems)
    .where(eq(menuItems.tenantId, actor.tenantId));
  const byId = new Map(dbItems.map((i) => [i.id, i]));

  const lines = [];
  for (const it of parsed.data.items) {
    const dbi = byId.get(it.menuItemId);
    if (!dbi || !dbi.available) {
      return NextResponse.json(
        { error: "item_unavailable", id: it.menuItemId },
        { status: 409 },
      );
    }
    if (!ids.includes(it.menuItemId)) continue;
    lines.push({
      name: dbi.name,
      quantity: it.quantity,
      unitPriceCents: dbi.priceCents,
      notes: it.notes,
      modifiers: it.modifiers,
    });
  }
  if (lines.length === 0) {
    return NextResponse.json({ error: "no_valid_items" }, { status: 400 });
  }

  // Mig 049: si el actor es un empleado del keypad, persistimos
  // created_by_employee_id (canónico). Si es el owner directo desde el
  // dashboard, mantenemos created_by_waiter_id (retro-compat reportes).
  const orderMetadata =
    actor.kind === "employee"
      ? { created_by_employee_id: actor.employeeId, employee_name: actor.name }
      : { created_by_waiter_id: actor.userId };

  let order;
  try {
    order = await createOrder({
      tenantId: actor.tenantId,
      orderType: "dine_in",
      tableNumber: parsed.data.tableNumber,
      notes: parsed.data.notes,
      items: lines,
      isTest: false,
      metadata: orderMetadata,
      // Comandero = staff interno físicamente en el local. Salta guards
      // de horario público y de idempotency (un mesero PUEDE crear 2
      // pedidos iguales para mesas distintas en <60s).
      bypassGuards: true,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Mensaje legible al frontend en lugar de Error 500 críptico.
    if (msg === "session_in_billing") {
      return NextResponse.json({ error: "session_in_billing", message: "La cuenta ya se pidió. No puedes añadir más items." }, { status: 409 });
    }
    if (msg.startsWith("out_of_stock")) {
      return NextResponse.json({ error: "out_of_stock", message: msg }, { status: 409 });
    }
    // Defensa: cualquier error → 500 con mensaje legible (no Error 500 mudo).
    console.error("[comandero/orders] createOrder fail", err);
    return NextResponse.json({ error: "create_order_failed", message: msg.slice(0, 200) }, { status: 500 });
  }

  return NextResponse.json({
    orderId: order.id,
    totalCents: order.totalCents,
    currency: order.currency,
  });
}
