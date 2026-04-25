// web/app/api/comandero/login/route.ts
//
// POST { tenantSlug, pin } → emite cookie de empleado si match.
// El comandero corre como app standalone; el slug del tenant viene como
// hint del cliente (lo guarda en localStorage tras el primer login del
// owner). Si no coincide con un empleado activo del tenant, devuelve 401
// genérico para no leak de cuáles tenants existen.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { employees, tenants } from "@/lib/db/schema";
import { findEmployeeByPin, issueEmployeeCookie } from "@/lib/employees/auth";
import { limitByIpWebchat } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BODY = z.object({
  tenantSlug: z.string().min(1).max(100),
  pin: z.string().regex(/^\d{4,6}$/),
});

export async function POST(req: NextRequest) {
  // Rate-limit por IP — 5/min protege contra brute-force a 10⁶ PINs.
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  const rl = await limitByIpWebchat(ip);
  if (!rl.ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const parsed = BODY.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_input" }, { status: 400 });
  }

  const [tenant] = await db
    .select({ id: tenants.id, name: tenants.name })
    .from(tenants)
    .where(eq(tenants.slug, parsed.data.tenantSlug))
    .limit(1);
  if (!tenant) {
    return NextResponse.json({ error: "invalid" }, { status: 401 });
  }

  const employee = await findEmployeeByPin(tenant.id, parsed.data.pin);
  if (!employee) {
    return NextResponse.json({ error: "invalid" }, { status: 401 });
  }

  await db
    .update(employees)
    .set({ lastLoginAt: new Date(), updatedAt: new Date() })
    .where(eq(employees.id, employee.id));

  await issueEmployeeCookie({
    sub: employee.id,
    tid: tenant.id,
    rol: employee.role,
    name: employee.name,
  });

  return NextResponse.json({
    ok: true,
    employee: {
      id: employee.id,
      name: employee.name,
      role: employee.role,
    },
    tenant: { id: tenant.id, name: tenant.name },
  });
}
