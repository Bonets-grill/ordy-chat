// web/app/api/public/sessions/[id]/pay/route.ts
//
// Fase 4 del plan de sesión de mesa: crea un Stripe Checkout Session para
// cobrar una table_session que esté en estado 'billing'. Devuelve la URL
// para que el cliente pague desde su móvil.
//
// Flujo:
// 1. Cliente pide la cuenta → sesión pasa a 'billing' (Fase 3).
// 2. Cliente tap "Pagar con tarjeta" → fetch POST a este endpoint.
// 3. Devolvemos {url} de Stripe Checkout. Cliente abre en nueva pestaña.
// 4. Usuario paga. Stripe manda webhook checkout.session.completed con
//    metadata.table_session_id → webhook transiciona la sesión a 'paid'
//    y marca los orders linkeados como 'paid'.
// 5. Cliente ve status='paid' en el próximo poll → chat muestra gracias.
//
// Auth: público (cualquiera con el session_id y el slug del tenant puede
// pagar). Rate limit por IP para evitar abuso.

import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { agentConfigs, tableSessions, tenants } from "@/lib/db/schema";
import { limitByIpWebchat } from "@/lib/rate-limit";
import { stripeClient } from "@/lib/stripe";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await params;

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  const rl = await limitByIpWebchat(ip);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  // UUID paranoia check.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) {
    return NextResponse.json({ error: "bad_session_id" }, { status: 400 });
  }

  const [row] = await db
    .select({
      id: tableSessions.id,
      tenantId: tableSessions.tenantId,
      tableNumber: tableSessions.tableNumber,
      status: tableSessions.status,
      totalCents: tableSessions.totalCents,
      stripeCheckoutSessionId: tableSessions.stripeCheckoutSessionId,
      isTest: tableSessions.isTest,
      tenantSlug: tenants.slug,
      tenantName: tenants.name,
    })
    .from(tableSessions)
    .innerJoin(tenants, eq(tenants.id, tableSessions.tenantId))
    .where(eq(tableSessions.id, sessionId))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: "session_not_found" }, { status: 404 });
  }
  if (row.isTest) {
    return NextResponse.json({ error: "test_session_cannot_pay" }, { status: 400 });
  }
  if (row.status !== "billing" && row.status !== "active") {
    // Permitimos pagar desde 'active' también (atajo: cliente pide
    // "pagar ya" sin haber pedido la cuenta antes).
    return NextResponse.json(
      { error: "session_not_billable", status: row.status },
      { status: 409 },
    );
  }
  if (row.totalCents <= 0) {
    return NextResponse.json({ error: "empty_session" }, { status: 400 });
  }

  // Gate: el tenant debe haber habilitado pagos online.
  const [cfg] = await db
    .select({ acceptOnlinePayment: agentConfigs.acceptOnlinePayment })
    .from(agentConfigs)
    .where(eq(agentConfigs.tenantId, row.tenantId))
    .limit(1);
  if (!cfg?.acceptOnlinePayment) {
    return NextResponse.json(
      { error: "online_payment_disabled", hint: "El tenant no acepta pagos online." },
      { status: 409 },
    );
  }

  // Stripe client (puede lanzar si no hay keys — eso es Human TODO del owner).
  let stripe;
  try {
    stripe = await stripeClient();
  } catch {
    return NextResponse.json(
      { error: "stripe_not_configured", hint: "Falta STRIPE_SECRET_KEY." },
      { status: 503 },
    );
  }

  // Si ya había un Checkout abierto, reusamos su URL (idempotencia).
  if (row.stripeCheckoutSessionId) {
    try {
      const existing = await stripe.checkout.sessions.retrieve(row.stripeCheckoutSessionId);
      if (existing.url && existing.status === "open") {
        return NextResponse.json({ url: existing.url, reused: true });
      }
    } catch {
      // session vieja inválida — creamos nueva.
    }
  }

  const origin = new URL(req.url).origin;
  const successUrl = `${origin}/m/${row.tenantSlug}?mesa=${encodeURIComponent(row.tableNumber)}&pago=ok`;
  const cancelUrl = `${origin}/m/${row.tenantSlug}?mesa=${encodeURIComponent(row.tableNumber)}&pago=cancel`;

  // Una sola línea genérica con el total. Alternativa: itemizar todos los
  // orders/items, pero eso complica el Checkout y Stripe recalcula impuestos.
  // Aquí pricesIncludeTax se asume true (comportamiento restaurante típico).
  const checkout = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "eur",
          product_data: {
            name: `${row.tenantName} — Mesa ${row.tableNumber}`,
            description: "Consumiciones de la mesa",
          },
          unit_amount: row.totalCents,
        },
        quantity: 1,
      },
    ],
    metadata: {
      table_session_id: row.id,
      tenant_id: row.tenantId,
      table_number: row.tableNumber,
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });

  if (!checkout.url) {
    return NextResponse.json({ error: "stripe_no_url" }, { status: 502 });
  }

  // Persistimos el checkout id para idempotencia + trazabilidad.
  await db
    .update(tableSessions)
    .set({
      stripeCheckoutSessionId: checkout.id,
      status: row.status === "active" ? "billing" : row.status,
      billRequestedAt: row.status === "active" ? new Date() : undefined,
      updatedAt: new Date(),
    })
    .where(eq(tableSessions.id, row.id));

  return NextResponse.json({ url: checkout.url, reused: false });
}
