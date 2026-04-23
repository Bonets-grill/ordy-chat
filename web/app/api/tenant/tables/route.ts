// web/app/api/tenant/tables/route.ts
//
// CRUD de mesas del tenant (migración 035).
//   GET  → lista todas las mesas del tenant (activas + inactivas, ordenadas).
//   POST → crea una mesa. Body: { number, zone?, seats?, active? }.

import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { restaurantTables } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";

// `number` del QR: 1-8 chars alfanuméricos + guión. Evita inyección y
// garantiza URLs limpias tipo /m/<slug>?mesa=T1.
const numberSchema = z
  .string()
  .trim()
  .min(1)
  .max(8)
  .regex(/^[A-Za-z0-9-]+$/, "Solo letras, dígitos y guión");

const createSchema = z.object({
  number: numberSchema,
  zone: z.string().trim().max(60).nullable().optional(),
  seats: z.number().int().min(1).max(99).optional(),
  active: z.boolean().optional(),
});

export async function GET() {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rows = await db
    .select()
    .from(restaurantTables)
    .where(eq(restaurantTables.tenantId, bundle.tenant.id))
    .orderBy(asc(restaurantTables.sortOrder), asc(restaurantTables.number));

  return NextResponse.json({ tables: rows });
}

export async function POST(req: Request) {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "bad_input", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // Unique (tenant_id, number) en DB — devolver 409 si ya existe.
  try {
    const [created] = await db
      .insert(restaurantTables)
      .values({
        tenantId: bundle.tenant.id,
        number: parsed.data.number,
        zone: parsed.data.zone ?? null,
        seats: parsed.data.seats ?? 4,
        active: parsed.data.active ?? true,
      })
      .returning();
    return NextResponse.json({ ok: true, table: created });
  } catch (e) {
    // Postgres unique violation = 23505.
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("duplicate key") || msg.includes("23505")) {
      return NextResponse.json(
        { error: "duplicate", detail: `Ya existe una mesa "${parsed.data.number}"` },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "db_error", detail: msg.slice(0, 200) }, { status: 500 });
  }
}
