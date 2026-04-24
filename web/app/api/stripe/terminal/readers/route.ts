// web/app/api/stripe/terminal/readers/route.ts
//
// GET  /api/stripe/terminal/readers — lista readers del tenant.
// POST /api/stripe/terminal/readers — empareja un nuevo reader con el tenant.
//   body: { registrationCode, label? }
//
// Multi-tenant: cada llamada usa stripe_account_id del tenant. Los readers
// de un tenant son aislados por la cuenta Stripe Connect — un tenant nunca
// puede ver readers de otra cuenta.
//
// Mig 045.

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { stripeTerminalReaders } from "@/lib/db/schema";
import { TenantNotConnected, stripeForTenant } from "@/lib/stripe-terminal";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";

const postSchema = z.object({
  registrationCode: z
    .string()
    .min(3, "registrationCode requerido (ej. 'simulated-wpe' o el código que muestra el lector)")
    .max(64),
  label: z.string().max(64).optional(),
});

export async function GET() {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rows = await db
    .select()
    .from(stripeTerminalReaders)
    .where(eq(stripeTerminalReaders.tenantId, bundle.tenant.id));

  return NextResponse.json({
    readers: rows.map((r) => ({
      id: r.id,
      readerId: r.readerId,
      label: r.label,
      serialNumber: r.serialNumber,
      status: r.status,
      lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
    })),
    connected: Boolean(bundle.tenant.stripeAccountId),
    locationId: bundle.tenant.stripeTerminalLocationId,
  });
}

export async function POST(req: Request) {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "bad_input", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const { stripe, requestOptions } = await stripeForTenant({
      id: bundle.tenant.id,
      stripeAccountId: bundle.tenant.stripeAccountId,
    });

    const reader = await stripe.terminal.readers.create(
      {
        registration_code: parsed.data.registrationCode,
        label: parsed.data.label,
        // Si el tenant tiene location configurada, asignamos el reader a ella.
        // Stripe REQUIERE location si la cuenta Connect tiene al menos una.
        ...(bundle.tenant.stripeTerminalLocationId
          ? { location: bundle.tenant.stripeTerminalLocationId }
          : {}),
      },
      requestOptions,
    );

    // Persistir en DB. UPSERT por (tenant_id, reader_id) — si ya existe,
    // actualizar el label (caller pidió emparejar de nuevo con label nuevo).
    const [row] = await db
      .insert(stripeTerminalReaders)
      .values({
        tenantId: bundle.tenant.id,
        readerId: reader.id,
        label: parsed.data.label ?? reader.label ?? null,
        serialNumber: reader.serial_number ?? null,
        status: reader.status === "online" ? "online" : "offline",
        lastSeenAt: reader.status === "online" ? new Date() : null,
      })
      .onConflictDoUpdate({
        target: [stripeTerminalReaders.tenantId, stripeTerminalReaders.readerId],
        set: {
          label: parsed.data.label ?? reader.label ?? null,
          serialNumber: reader.serial_number ?? null,
          status: reader.status === "online" ? "online" : "offline",
          updatedAt: new Date(),
        },
      })
      .returning();

    return NextResponse.json({
      ok: true,
      reader: {
        id: row.id,
        readerId: row.readerId,
        label: row.label,
        serialNumber: row.serialNumber,
        status: row.status,
      },
    });
  } catch (e) {
    if (e instanceof TenantNotConnected) {
      return NextResponse.json(
        { error: "stripe_connect_missing", message: e.message },
        { status: 412 },
      );
    }
    // Errores tipo "código de registro inválido" → bubble up al UI.
    return NextResponse.json(
      { error: "stripe_error", message: (e as Error).message },
      { status: 400 },
    );
  }
}
