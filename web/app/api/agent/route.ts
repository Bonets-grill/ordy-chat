import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { agentConfigs, tenantMembers } from "@/lib/db/schema";

const schema = z.object({
  tenantId: z.string().uuid(),
  agentName: z.string().min(2).optional(),
  tone: z.enum(["professional", "friendly", "sales", "empathetic"]).optional(),
  schedule: z.string().min(3).optional(),
  systemPrompt: z.string().min(20).optional(),
  paused: z.boolean().optional(),
});

export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad input" }, { status: 400 });

  const { tenantId, ...fields } = parsed.data;

  const [membership] = await db
    .select()
    .from(tenantMembers)
    .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, session.user.id)))
    .limit(1);
  if (!membership) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  await db
    .update(agentConfigs)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(agentConfigs.tenantId, tenantId));

  return NextResponse.json({ ok: true });
}
