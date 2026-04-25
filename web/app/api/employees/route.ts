// web/app/api/employees/route.ts
//
// GET  → list empleados del tenant del owner logueado.
// POST → crear empleado { name, pin, role? }.
// Solo accesible al owner (tenant_admin / super_admin) — el mesero
// común NO puede listar otros empleados.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { employees } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";
import { auth } from "@/lib/auth";
import { hashPin, isValidPin } from "@/lib/employees/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CREATE = z.object({
  name: z.string().min(1).max(80).trim(),
  pin: z.string().regex(/^\d{4,6}$/),
  role: z.enum(["waiter", "manager"]).default("waiter"),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauth" }, { status: 401 });
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const rows = await db
    .select({
      id: employees.id,
      name: employees.name,
      role: employees.role,
      active: employees.active,
      lastLoginAt: employees.lastLoginAt,
      createdAt: employees.createdAt,
    })
    .from(employees)
    .where(eq(employees.tenantId, bundle.tenant.id))
    .orderBy(employees.name);

  return NextResponse.json({ employees: rows });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauth" }, { status: 401 });
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const parsed = CREATE.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_input", issues: parsed.error.flatten() }, { status: 400 });
  }
  if (!isValidPin(parsed.data.pin)) {
    return NextResponse.json({ error: "invalid_pin" }, { status: 400 });
  }

  const pinHash = await hashPin(parsed.data.pin);
  const [row] = await db
    .insert(employees)
    .values({
      tenantId: bundle.tenant.id,
      name: parsed.data.name,
      pinHash,
      role: parsed.data.role,
      active: true,
    })
    .returning({ id: employees.id, name: employees.name, role: employees.role });

  return NextResponse.json({ employee: row });
}
