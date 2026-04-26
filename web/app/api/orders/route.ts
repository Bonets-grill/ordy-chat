// web/app/api/orders/route.ts
//
// POST: el runtime crea órdenes usando RUNTIME_INTERNAL_SECRET (no session user).
// GET: el tenant del dashboard ve sus órdenes recientes.

import { and, desc, eq, gte, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { orders, tenants } from "@/lib/db/schema";
import { validateInternalSecret } from "@/lib/cron";
import { createOrder, DuplicateOrderError, NoOpenShiftError, OutOfHoursError } from "@/lib/orders";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";

const createSchema = z.object({
  tenantSlug: z.string().min(1),
  // Mig 027: nuevo workflow cocina ↔ cliente. orderType siempre se persiste; default
  // 'takeaway' por backward-compat con callers legacy que aún no envían el campo.
  orderType: z.enum(["dine_in", "takeaway"]).default("takeaway"),
  customerPhone: z.string().optional(),
  customerName: z.string().optional(),
  tableNumber: z.string().optional(),
  notes: z.string().optional(),
  // Mig 029: solo el runtime con x-internal-secret puede setearlo (este endpoint
  // ya está gateado por ese secret). true = pedido de playground → is_test=true.
  isTest: z.boolean().optional(),
  items: z.array(
    z.object({
      name: z.string().min(1),
      quantity: z.number().int().min(1),
      unitPriceCents: z.number().int().min(0),
      vatRate: z.number().min(0).max(100).optional(),
      notes: z.string().optional(),
      // Mig 042 — bot WA / widget público pasan los modifiers seleccionados.
      // priceDeltaCents debe ser >=0 (rechaza descuentos por defensa).
      modifiers: z
        .array(
          z.object({
            groupId: z.string().min(1),
            modifierId: z.string().min(1),
            name: z.string().min(1),
            priceDeltaCents: z.number().int().min(0).max(100_000),
          }),
        )
        .max(50)
        .optional(),
    }),
  ).min(1),
}).refine(
  (d) => d.orderType !== "dine_in" || (d.tableNumber != null && d.tableNumber.trim().length > 0),
  { message: "tableNumber requerido para order_type=dine_in", path: ["tableNumber"] },
).refine(
  (d) => d.orderType !== "takeaway" || (d.customerName != null && d.customerName.trim().length > 0),
  { message: "customerName requerido para order_type=takeaway", path: ["customerName"] },
);

export async function POST(req: Request) {
  // CN-012 fix 2026-04-26: timing-safe comparison via helper.
  const unauthorized = validateInternalSecret(req);
  if (unauthorized) return unauthorized;

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

  // Dedup anti-triplicación 2026-04-24 — Mario vio 3 pedidos idénticos
  // en 38s porque el LLM llamaba crear_pedido varias veces. Guard: si
  // en los últimos 60s ya existe un pedido pending_kitchen_review mismo
  // tenant + misma mesa/phone + mismo total y nº de items, devolvemos
  // el existente en vez de crear duplicado.
  const totalGuess = parsed.data.items.reduce(
    (sum, it) => sum + it.unitPriceCents * it.quantity,
    0,
  );
  const sameIdentityClause =
    parsed.data.orderType === "dine_in" && parsed.data.tableNumber
      ? eq(orders.tableNumber, parsed.data.tableNumber)
      : parsed.data.customerPhone
        ? eq(orders.customerPhone, parsed.data.customerPhone)
        : undefined;
  if (sameIdentityClause) {
    const [recent] = await db
      .select({ id: orders.id, totalCents: orders.totalCents, currency: orders.currency, isTest: orders.isTest })
      .from(orders)
      .where(
        and(
          eq(orders.tenantId, tenant.id),
          eq(orders.status, "pending_kitchen_review"),
          sameIdentityClause,
          gte(orders.createdAt, sql`now() - interval '60 seconds'`),
          eq(orders.totalCents, totalGuess),
        ),
      )
      .limit(1);
    if (recent) {
      return NextResponse.json({
        orderId: recent.id,
        totalCents: recent.totalCents,
        currency: recent.currency,
        isTest: recent.isTest,
        deduped: true,
      });
    }
  }

  let order;
  try {
    order = await createOrder({
      tenantId: tenant.id,
      orderType: parsed.data.orderType,
      customerPhone: parsed.data.customerPhone,
      customerName: parsed.data.customerName,
      tableNumber: parsed.data.tableNumber,
      notes: parsed.data.notes,
      items: parsed.data.items,
      isTest: parsed.data.isTest ?? false,
    });
  } catch (err) {
    if (err instanceof OutOfHoursError) {
      // Bug Bonets 2026-04-26: el bot creaba pedidos fuera de horario porque
      // el LLM ignoraba el system prompt. Server-side rechazo claro.
      return NextResponse.json(
        { error: "out_of_hours", schedule: err.schedule },
        { status: 409 },
      );
    }
    if (err instanceof NoOpenShiftError) {
      // 2026-04-26 (Mario decisión): pedidos requieren turno POS abierto.
      // El cron auto-open-shifts abre turnos cuando entra el horario; si
      // llega un pedido fuera de horario o el cron no corrió aún, rechazo.
      return NextResponse.json(
        {
          error: "no_open_shift",
          message: "No hay turno POS abierto. El turno se abre automáticamente cuando entra el horario del negocio.",
        },
        { status: 409 },
      );
    }
    if (err instanceof DuplicateOrderError) {
      // Bug Bonets 2026-04-26: el LLM ejecutaba crear_pedido 2x en la misma
      // sesión. Idempotency en createOrder devuelve el order existente como
      // si fuera la primera vez (el cliente recibe la confirmación 1x).
      const [existing] = await db
        .select({ id: orders.id, totalCents: orders.totalCents, currency: orders.currency, isTest: orders.isTest })
        .from(orders).where(eq(orders.id, err.existingOrderId)).limit(1);
      if (existing) {
        return NextResponse.json({
          orderId: existing.id,
          totalCents: existing.totalCents,
          currency: existing.currency,
          isTest: existing.isTest,
          deduped: true,
        });
      }
    }
    const msg = err instanceof Error ? err.message : String(err);
    // Fase 6: bloqueo de añadir items tras pedir la cuenta. El runtime lee
    // este error y traduce a un mensaje al cliente ("la cuenta ya se pidió,
    // avisa al camarero si quieres añadir algo").
    if (msg === "session_in_billing") {
      return NextResponse.json(
        { error: "session_in_billing" },
        { status: 409 },
      );
    }
    throw err;
  }

  return NextResponse.json({
    orderId: order.id,
    totalCents: order.totalCents,
    currency: order.currency,
    isTest: order.isTest,
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
