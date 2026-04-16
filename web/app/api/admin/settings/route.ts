import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { cifrar } from "@/lib/crypto";
import { db } from "@/lib/db";
import { platformSettings } from "@/lib/db/schema";

const schema = z.object({
  updates: z.record(z.string(), z.string()),
});

export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "super_admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad input" }, { status: 400 });

  for (const [key, value] of Object.entries(parsed.data.updates)) {
    if (!value.trim()) continue;
    const encrypted = cifrar(value);
    await db
      .insert(platformSettings)
      .values({ key, valueEncrypted: encrypted, updatedBy: session.user.id })
      .onConflictDoUpdate({
        target: platformSettings.key,
        set: { valueEncrypted: encrypted, updatedBy: session.user.id, updatedAt: sql`now()` },
      });
  }
  return NextResponse.json({ ok: true });
}

export async function GET() {
  const session = await auth();
  if (!session || session.user.role !== "super_admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const rows = await db.select({ key: platformSettings.key, populated: sql<boolean>`value_encrypted <> ''` }).from(platformSettings);
  return NextResponse.json({ rows });
}
