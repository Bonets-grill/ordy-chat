// web/app/api/appointments/route.ts
// GET — lista citas/reservas del tenant. Por defecto muestra las próximas
// (startsAt >= ahora - 2h para que las recién pasadas sigan siendo visibles
// un rato). Query opcional `?scope=past` devuelve histórico.

import { NextResponse } from "next/server";
import { and, desc, eq, gte, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { appointments } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const bundle = await requireTenant();
  if (!bundle) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const scope = url.searchParams.get("scope") === "past" ? "past" : "upcoming";

  const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h atrás

  const rows = await db
    .select()
    .from(appointments)
    .where(
      and(
        eq(appointments.tenantId, bundle.tenant.id),
        scope === "upcoming"
          ? gte(appointments.startsAt, cutoff)
          : lt(appointments.startsAt, cutoff),
      ),
    )
    .orderBy(scope === "upcoming" ? appointments.startsAt : desc(appointments.startsAt))
    .limit(200);

  return NextResponse.json(
    {
      appointments: rows.map((a) => ({
        id: a.id,
        customerPhone: a.customerPhone,
        customerName: a.customerName,
        startsAt: a.startsAt.toISOString(),
        durationMin: a.durationMin,
        title: a.title,
        notes: a.notes,
        status: a.status,
        createdAt: a.createdAt.toISOString(),
      })),
      scope,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
