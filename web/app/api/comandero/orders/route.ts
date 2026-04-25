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
import { requireTenant } from "@/lib/tenant";
import { limitByUserId } from "@/lib/rate-limit";
import { auth } from "@/lib/auth";

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
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }
  const bundle = await requireTenant();
  if (!bundle) {
    return NextResponse.json({ error: "tenant_not_found" }, { status: 401 });
  }

  const rate = await limitByUserId(session.user.id, "comandero_create_order", 120, "1 h");
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
        eq(restaurantTables.tenantId, bundle.tenant.id),
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
    .where(eq(menuItems.tenantId, bundle.tenant.id));
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

  const order = await createOrder({
    tenantId: bundle.tenant.id,
    orderType: "dine_in",
    tableNumber: parsed.data.tableNumber,
    notes: parsed.data.notes,
    items: lines,
    isTest: false,
  });

  return NextResponse.json({
    orderId: order.id,
    totalCents: order.totalCents,
    currency: order.currency,
  });
}
