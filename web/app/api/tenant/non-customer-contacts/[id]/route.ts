import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { nonCustomerContacts } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, ctx: Ctx) {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const res = await db
    .delete(nonCustomerContacts)
    .where(and(eq(nonCustomerContacts.id, id), eq(nonCustomerContacts.tenantId, bundle.tenant.id)))
    .returning({ id: nonCustomerContacts.id });
  if (res.length === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
