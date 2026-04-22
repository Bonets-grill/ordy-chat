// web/app/api/kds/reservations/route.ts
// Devuelve las próximas reservas del tenant para mostrarlas como ventana extra
// dentro del KDS. Filtra futuras (starts_at >= ahora - 1h, para que sigan
// visibles si están en curso) y ordena ASC. Limit 30.

import { NextResponse } from "next/server";
import { and, asc, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { appointments } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";

export async function GET() {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const since = new Date(Date.now() - 60 * 60 * 1000); // 1h atrás (ya en curso)
  const rows = await db
    .select({
      id: appointments.id,
      customerPhone: appointments.customerPhone,
      customerName: appointments.customerName,
      startsAt: appointments.startsAt,
      durationMin: appointments.durationMin,
      title: appointments.title,
      notes: appointments.notes,
      status: appointments.status,
    })
    .from(appointments)
    .where(and(eq(appointments.tenantId, bundle.tenant.id), gte(appointments.startsAt, since)))
    .orderBy(asc(appointments.startsAt))
    .limit(30);

  return NextResponse.json(
    {
      reservations: rows.map((r) => ({
        ...r,
        startsAt: r.startsAt.toISOString(),
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
