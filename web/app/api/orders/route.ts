// web/app/api/orders/route.ts
//
// POST: el runtime crea órdenes usando RUNTIME_INTERNAL_SECRET (no session user).
// GET: el tenant del dashboard ve sus órdenes recientes.

import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { orders, tenants } from "@/lib/db/schema";
import { createOrder } from "@/lib/orders";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";

const createSchema = z.object({
  tenantSlug: z.string().min(1),
  customerPhone: z.string().optional(),
  customerName: z.string().optional(),
  tableNumber: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(
    z.object({
      name: z.string().min(1),
      quantity: z.number().int().min(1),
      unitPriceCents: z.number().int().min(0),
      vatRate: z.number().min(0).max(100).optional(),
      notes: z.string().optional(),
    }),
  ).min(1),
});

export async function POST(req: Request) {
  // Interno: el runtime firma con RUNTIME_INTERNAL_SECRET
  const provided = req.headers.get("x-internal-secret") ?? "";
  const expected = process.env.RUNTIME_INTERNAL_SECRET ?? "";
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_input", issues: parsed.error.flatten() }, { status: 400 });
  }

  const [tenant] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, parsed.data.tenantSlug))
    .limit(1);
  if (!tenant) return NextResponse.json({ error: "tenant_not_found" }, { status: 404 });

  const order = await createOrder({
    tenantId: tenant.id,
    customerPhone: parsed.data.customerPhone,
    customerName: parsed.data.customerName,
    tableNumber: parsed.data.tableNumber,
    notes: parsed.data.notes,
    items: parsed.data.items,
  });

  return NextResponse.json({
    orderId: order.id,
    totalCents: order.totalCents,
    currency: order.currency,
  });
}

export async function GET() {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const rows = await db
    .select()
    .from(orders)
    .where(eq(orders.tenantId, bundle.tenant.id))
    .orderBy(desc(orders.createdAt))
    .limit(50);

  return NextResponse.json({ orders: rows });
}
