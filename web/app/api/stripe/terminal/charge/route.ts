// web/app/api/stripe/terminal/charge/route.ts
//
// POST /api/stripe/terminal/charge — dispara el cobro al lector físico.
//   body: { orderId, readerId }   (readerId = stripe_terminal_readers.id UUID)
//
// Pasos:
//   1. Carga la orden del tenant. Verifica ownership y que no esté ya pagada.
//   2. Crea PaymentIntent con payment_method_types=['card_present'].
//   3. Crea fila pos_payments con status='pending' (idempotente: si ya hay
//      una fila con el mismo PI, devuelve esa).
//   4. Llama terminal.readers.processPaymentIntent(readerId, { payment_intent }).
//   5. Devuelve { paymentId, paymentIntentId, status }.
//
// El cliente (KDS o /dashboard/tpv) hace polling a
// GET /api/stripe/terminal/payments/[id]/status hasta que succeed/failed.
//
// Mig 045.

import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { orders, posPayments, stripeTerminalReaders } from "@/lib/db/schema";
import { requireTenantOrKiosk } from "@/lib/kiosk-auth";
import { TenantNotConnected, stripeForTenant } from "@/lib/stripe-terminal";

export const runtime = "nodejs";

const bodySchema = z.object({
  orderId: z.string().uuid(),
  readerId: z.string().uuid(),
});

export async function POST(req: Request) {
  const bundle = await requireTenantOrKiosk(req);
  if (!bundle) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "bad_input", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Ownership orden + reader.
  const [order] = await db
    .select()
    .from(orders)
    .where(
      and(eq(orders.id, parsed.data.orderId), eq(orders.tenantId, bundle.tenant.id)),
    )
    .limit(1);
  if (!order) {
    return NextResponse.json({ error: "order_not_found" }, { status: 404 });
  }
  if (order.status === "paid") {
    return NextResponse.json({ error: "order_already_paid" }, { status: 409 });
  }
  if (order.totalCents <= 0) {
    return NextResponse.json({ error: "order_total_zero" }, { status: 400 });
  }

  const [reader] = await db
    .select()
    .from(stripeTerminalReaders)
    .where(
      and(
        eq(stripeTerminalReaders.id, parsed.data.readerId),
        eq(stripeTerminalReaders.tenantId, bundle.tenant.id),
      ),
    )
    .limit(1);
  if (!reader) {
    return NextResponse.json({ error: "reader_not_found" }, { status: 404 });
  }

  try {
    const { stripe, requestOptions } = await stripeForTenant({
      id: bundle.tenant.id,
      stripeAccountId: bundle.tenant.stripeAccountId,
    });

    // Crear PaymentIntent. Metadata usada por el webhook para resolver tenant
    // y order al recibir payment_intent.succeeded.
    const pi = await stripe.paymentIntents.create(
      {
        amount: order.totalCents,
        currency: (order.currency ?? "EUR").toLowerCase(),
        payment_method_types: ["card_present"],
        capture_method: "automatic",
        metadata: {
          tenant_id: bundle.tenant.id,
          order_id: order.id,
          reader_id: reader.readerId,
          source: "ordy_terminal",
        },
      },
      requestOptions,
    );

    // Persistir pos_payments. UNIQUE en payment_intent_id → si ya existe
    // (retry), devolvemos la fila existente.
    const [payment] = await db
      .insert(posPayments)
      .values({
        tenantId: bundle.tenant.id,
        orderId: order.id,
        readerId: reader.readerId,
        paymentIntentId: pi.id,
        status: "pending",
        amountCents: order.totalCents,
        currency: (order.currency ?? "EUR").toUpperCase(),
      })
      .onConflictDoNothing({ target: posPayments.paymentIntentId })
      .returning();

    // Si el insert no devolvió nada (conflicto), recuperar la fila existente.
    let paymentRow = payment;
    if (!paymentRow) {
      const [existing] = await db
        .select()
        .from(posPayments)
        .where(eq(posPayments.paymentIntentId, pi.id))
        .limit(1);
      paymentRow = existing;
    }

    // Disparar al lector. Si falla, marcamos pos_payments.status='failed'
    // pero NO borramos — historial completo de intentos.
    try {
      await stripe.terminal.readers.processPaymentIntent(
        reader.readerId,
        { payment_intent: pi.id },
        requestOptions,
      );
    } catch (e) {
      await db
        .update(posPayments)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(posPayments.id, paymentRow.id));
      return NextResponse.json(
        {
          error: "reader_process_failed",
          message: (e as Error).message,
          paymentId: paymentRow.id,
          paymentIntentId: pi.id,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      paymentId: paymentRow.id,
      paymentIntentId: pi.id,
      status: paymentRow.status,
    });
  } catch (e) {
    if (e instanceof TenantNotConnected) {
      return NextResponse.json(
        { error: "stripe_connect_missing", message: e.message },
        { status: 412 },
      );
    }
    return NextResponse.json(
      { error: "stripe_error", message: (e as Error).message },
      { status: 500 },
    );
  }
}
