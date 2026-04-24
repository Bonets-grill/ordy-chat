import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { nonCustomerContacts } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";

const createSchema = z.object({
  phone: z.string().trim().min(6).max(20).regex(/^\+?\d[\d\s-]*$/, "Teléfono inválido"),
  label: z.string().trim().min(1).max(100),
  kind: z.enum(["proveedor", "comercial", "otro"]).default("proveedor"),
  notes: z.string().trim().max(500).nullable().optional(),
});

function normalizePhone(raw: string): string {
  return raw.replace(/[^0-9]/g, "");
}

export async function GET() {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const rows = await db
    .select()
    .from(nonCustomerContacts)
    .where(eq(nonCustomerContacts.tenantId, bundle.tenant.id))
    .orderBy(asc(nonCustomerContacts.label));
  return NextResponse.json({ contacts: rows });
}

export async function POST(req: Request) {
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_input", issues: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const [created] = await db
      .insert(nonCustomerContacts)
      .values({
        tenantId: bundle.tenant.id,
        phone: normalizePhone(parsed.data.phone),
        label: parsed.data.label,
        kind: parsed.data.kind,
        notes: parsed.data.notes ?? null,
      })
      .returning();
    return NextResponse.json({ ok: true, contact: created });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("duplicate key") || msg.includes("23505")) {
      return NextResponse.json(
        { error: "duplicate", detail: "Ya existe un contacto con ese teléfono" },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "db_error", detail: msg.slice(0, 200) }, { status: 500 });
  }
}
