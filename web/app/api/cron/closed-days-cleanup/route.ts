// web/app/api/cron/closed-days-cleanup/route.ts
// Vercel Cron diario: purga fechas pasadas de agent_configs.reservations_closed_for.
// Housekeeping para que el array no crezca indefinidamente y los tenants no
// tengan que limpiar manualmente los días de vacaciones ya consumidos.
//
// Schedule: 03:00 UTC = 04:00 Madrid invierno / 05:00 verano. Sin impacto
// porque solo tocamos fechas ya pasadas, las operaciones del día no se afectan.

import { NextResponse, type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";
import { validateCronAuth } from "@/lib/cron";

export const dynamic = "force-dynamic";

type PurgeRow = { tenantId: string; purged: number };

export async function GET(req: NextRequest) {
  const unauthorized = validateCronAuth(req);
  if (unauthorized) return unauthorized;

  // Solo tocamos filas con al menos una fecha pasada; array_agg + unnest filtra
  // in-place y el WHERE EXISTS evita updates no-op que rompen el cache de Neon.
  const rows = (await db.execute(sql`
    WITH updated AS (
      UPDATE agent_configs
      SET reservations_closed_for = COALESCE(
        (
          SELECT array_agg(d ORDER BY d)
          FROM unnest(reservations_closed_for) AS d
          WHERE d >= CURRENT_DATE
        ),
        ARRAY[]::DATE[]
      ),
      updated_at = now()
      WHERE cardinality(reservations_closed_for) > 0
        AND EXISTS (
          SELECT 1 FROM unnest(reservations_closed_for) AS d WHERE d < CURRENT_DATE
        )
      RETURNING tenant_id,
        (
          SELECT count(*) FROM unnest(agent_configs.reservations_closed_for) AS d
          WHERE d < CURRENT_DATE
        )::int AS purged_count
    )
    SELECT tenant_id AS "tenantId", purged_count AS "purged" FROM updated;
  `)) as unknown as PurgeRow[];

  const totalPurged = rows.reduce((acc, r) => acc + (r.purged ?? 0), 0);
  const tenantCount = rows.length;

  if (tenantCount > 0) {
    await db.insert(auditLog).values({
      action: "agent_config.closed_days_cleanup",
      entity: "agent_configs",
      metadata: { tenantCount, totalPurged },
    });
  }

  return NextResponse.json({ ok: true, tenantCount, totalPurged });
}
