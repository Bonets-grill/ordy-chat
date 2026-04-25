// web/app/api/employees/[id]/route.ts
//
// PATCH { name?, pin?, role?, active? } — actualiza un empleado.
// DELETE                                — soft delete vía active=false.
// Validación de ownership: tenantId del empleado debe matchear el tenant
// del owner.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { employees } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";
import { auth } from "@/lib/auth";
import { hashPin } from "@/lib/employees/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PATCH_BODY = z.object({
  name: z.string().min(1).max(80).trim().optional(),
  pin: z.string().regex(/^\d{4,6}$/).optional(),
  role: z.enum(["waiter", "manager"]).optional(),
  active: z.boolean().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauth" }, { status: 401 });
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const { id } = await params;
  const parsed = PATCH_BODY.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_input" }, { status: 400 });
  }

  const updates: Partial<typeof employees.$inferInsert> = { updatedAt: new Date() };
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.pin !== undefined) updates.pinHash = await hashPin(parsed.data.pin);
  if (parsed.data.role !== undefined) updates.role = parsed.data.role;
  if (parsed.data.active !== undefined) updates.active = parsed.data.active;

  const [row] = await db
    .update(employees)
    .set(updates)
    .where(and(eq(employees.id, id), eq(employees.tenantId, bundle.tenant.id)))
    .returning({ id: employees.id, name: employees.name, role: employees.role, active: employees.active });

  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ employee: row });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauth" }, { status: 401 });
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const { id } = await params;
  const [row] = await db
    .update(employees)
    .set({ active: false, updatedAt: new Date() })
    .where(and(eq(employees.id, id), eq(employees.tenantId, bundle.tenant.id)))
    .returning({ id: employees.id });

  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
