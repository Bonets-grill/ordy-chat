import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { conversations, messages } from "@/lib/db/schema";
import { requireTenant } from "@/lib/tenant";

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauth" }, { status: 401 });
  const bundle = await requireTenant();
  if (!bundle) return NextResponse.json({ error: "no tenant" }, { status: 404 });

  const rows = await db
    .select({
      phone: conversations.phone,
      customerName: conversations.customerName,
      role: messages.role,
      content: messages.content,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(eq(messages.tenantId, bundle.tenant.id))
    .orderBy(asc(conversations.phone), asc(messages.createdAt));

  const header = "telefono,nombre,rol,mensaje,fecha";
  const body = rows
    .map((r) => [
      csvEscape(r.phone),
      csvEscape(r.customerName ?? ""),
      r.role,
      csvEscape(r.content),
      new Date(r.createdAt).toISOString(),
    ].join(","))
    .join("\n");

  const csv = `${header}\n${body}`;
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ordy-chat-${bundle.tenant.slug}-${Date.now()}.csv"`,
    },
  });
}
