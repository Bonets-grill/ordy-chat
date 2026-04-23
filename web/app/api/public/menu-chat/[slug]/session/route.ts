// web/app/api/public/menu-chat/[slug]/session/route.ts
//
// GET público (sin auth) — devuelve el estado de la sesión de mesa para un
// (tenant, table_number). Se usa desde el cliente `/m/<slug>?mesa=N`:
//   - On mount: saber si hay sesión abierta y en qué estado (para que la X
//     del chat no pueda cerrar una sesión con pedido en marcha).
//   - Polling ligero: después de crear_pedido o kitchen.accept, el cliente
//     repolláa para ver la transición a active → billing → paid.
//
// Rate limit por IP (menú web) y rechazo si el tenant no existe.

import { and, desc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { tableSessions, tenants } from "@/lib/db/schema";
import { limitByIpWebchat } from "@/lib/rate-limit";

export const runtime = "nodejs";

// Aceptamos 1-8 chars alfanuméricos + "-" (mismo contrato que /m/<slug>).
const TABLE_RE = /^[A-Za-z0-9\-]{1,8}$/;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

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

  const url = new URL(req.url);
  const mesaRaw = (url.searchParams.get("mesa") ?? url.searchParams.get("table") ?? "").trim();
  if (!mesaRaw || !TABLE_RE.test(mesaRaw)) {
    return NextResponse.json({ session: null, reason: "no_table" });
  }

  const [tenant] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1);
  if (!tenant) {
    return NextResponse.json({ error: "tenant_not_found" }, { status: 404 });
  }

  // Más reciente de las sesiones "vivas" (pending, active, billing) o la
  // última cerrada (paid/closed) si el cliente acaba de pagar. La UI puede
  // usar una sesión paid/closed reciente para mostrar el mensaje de gracias.
  const [row] = await db
    .select({
      id: tableSessions.id,
      status: tableSessions.status,
      totalCents: tableSessions.totalCents,
      billRequestedAt: tableSessions.billRequestedAt,
      paidAt: tableSessions.paidAt,
      paymentMethod: tableSessions.paymentMethod,
      closedAt: tableSessions.closedAt,
      createdAt: tableSessions.createdAt,
    })
    .from(tableSessions)
    .where(
      and(
        eq(tableSessions.tenantId, tenant.id),
        eq(tableSessions.tableNumber, mesaRaw),
        inArray(tableSessions.status, ["pending", "active", "billing", "paid"]),
      ),
    )
    .orderBy(desc(tableSessions.createdAt))
    .limit(1);

  if (!row) {
    return NextResponse.json({ session: null });
  }

  return NextResponse.json({
    session: {
      id: row.id,
      status: row.status,
      totalCents: row.totalCents,
      billRequestedAt: row.billRequestedAt?.toISOString() ?? null,
      paidAt: row.paidAt?.toISOString() ?? null,
      paymentMethod: row.paymentMethod,
      closedAt: row.closedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    },
  });
}
